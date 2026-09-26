import { BadRequestException } from '@nestjs/common';
import { Prisma, VisitItemStatus } from '@prisma/client';
import { calculateVisitTotals, validateItemMoney, validateVisitCompletion } from './visit-rules';

describe('Visit business rules', () => {
  it('calculates authoritative totals with fixed precision', () => {
    const totals = calculateVisitTotals([
      { chargedPrice: new Prisma.Decimal('50.00'), discountAmount: new Prisma.Decimal('5.00') },
      { chargedPrice: new Prisma.Decimal('35.00'), discountAmount: new Prisma.Decimal('0.00') },
    ]);
    expect([
      totals.subtotal.toFixed(2),
      totals.discountAmount.toFixed(2),
      totals.total.toFixed(2),
    ]).toEqual(['85.00', '5.00', '80.00']);
  });
  it('rejects discounts that make an item negative', () => {
    expect(() => validateItemMoney(new Prisma.Decimal(10), new Prisma.Decimal(11))).toThrow(
      BadRequestException,
    );
  });
  it('rejects completion while an active item is incomplete', () => {
    expect(() =>
      validateVisitCompletion([
        { status: VisitItemStatus.COMPLETED },
        { status: VisitItemStatus.PENDING },
      ]),
    ).toThrow(BadRequestException);
  });
  it('allows completion when all non-cancelled items are complete', () => {
    expect(() =>
      validateVisitCompletion([
        { status: VisitItemStatus.COMPLETED },
        { status: VisitItemStatus.CANCELLED },
      ]),
    ).not.toThrow();
  });
});
