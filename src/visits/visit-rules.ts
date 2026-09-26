import { BadRequestException } from '@nestjs/common';
import { Prisma, VisitItemStatus } from '@prisma/client';

export function calculateVisitTotals(
  items: Array<{ chargedPrice: Prisma.Decimal; discountAmount: Prisma.Decimal }>,
) {
  const subtotal = items.reduce((sum, item) => sum.add(item.chargedPrice), new Prisma.Decimal(0));
  const discountAmount = items.reduce(
    (sum, item) => sum.add(item.discountAmount),
    new Prisma.Decimal(0),
  );
  return { subtotal, discountAmount, total: subtotal.sub(discountAmount) };
}

export function validateItemMoney(price: Prisma.Decimal, discount: Prisma.Decimal): void {
  if (price.isNegative() || discount.isNegative() || discount.greaterThan(price))
    throw new BadRequestException({
      code: 'VISIT_INVALID_DISCOUNT',
      message: 'Discount must be between zero and the charged price',
    });
}

export function validateVisitCompletion(items: Array<{ status: VisitItemStatus }>): void {
  const active = items.filter((item) => item.status !== VisitItemStatus.CANCELLED);
  if (!active.length || active.some((item) => item.status !== VisitItemStatus.COMPLETED))
    throw new BadRequestException({
      code: 'VISIT_ITEMS_NOT_COMPLETED',
      message: 'Complete all active treatments first',
    });
}
