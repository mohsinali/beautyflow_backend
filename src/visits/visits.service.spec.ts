import { NotFoundException } from '@nestjs/common';
import { Prisma, TenantRole, VisitItemStatus, VisitStatus } from '@prisma/client';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { VisitsService } from './visits.service';

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

const auth: AuthContext = {
  userId: 'user-1',
  email: 'provider@example.com',
  firstName: 'Sam',
  lastName: 'Provider',
  platformRole: null,
  tenantId: 'tenant-1',
  tenantSlug: 'salon',
  membershipId: 'membership-1',
  tenantRole: TenantRole.SERVICE_PROVIDER,
  sessionId: 'session-1',
  accessibleBranchIds: ['branch-1'],
};

const visit = {
  id: 'visit-1',
  tenantId: 'tenant-1',
  branchId: 'branch-1',
  status: VisitStatus.IN_PROGRESS,
  subtotal: new Prisma.Decimal(20),
  discountAmount: new Prisma.Decimal(0),
  total: new Prisma.Decimal(20),
  items: [
    {
      id: 'item-1',
      providerId: 'provider-1',
      status: VisitItemStatus.IN_PROGRESS,
      originalPrice: new Prisma.Decimal(10),
      chargedPrice: new Prisma.Decimal(10),
      discountAmount: new Prisma.Decimal(0),
    },
    {
      id: 'item-2',
      providerId: 'provider-1',
      status: VisitItemStatus.PENDING,
      originalPrice: new Prisma.Decimal(10),
      chargedPrice: new Prisma.Decimal(10),
      discountAmount: new Prisma.Decimal(0),
    },
  ],
};

function setup() {
  const transactionTarget: { current?: unknown } = {};
  const prisma = {
    branch: {
      findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }),
      findFirstOrThrow: jest.fn().mockResolvedValue({
        timezone: 'Asia/Karachi',
        tenant: { timezone: 'UTC' },
      }),
    },
    serviceProviderProfile: {
      findFirst: jest.fn().mockResolvedValue({ id: 'provider-1' }),
    },
    visitItem: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    visit: {
      findFirst: jest.fn().mockResolvedValue(visit),
    },
    $transaction: jest.fn((callback: (tx: unknown) => unknown): Promise<unknown> =>
      Promise.resolve(callback(transactionTarget.current)),
    ),
  };
  transactionTarget.current = prisma;
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new VisitsService(prisma as never, audit as never, {} as never);
  return { service, prisma };
}

describe('VisitsService provider work', () => {
  it('filters my work by authenticated provider, tenant, branch, and day', async () => {
    const { service, prisma } = setup();
    await service.myWork(auth, 'branch-1', '2026-09-27');
    expect(prisma.visitItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          providerId: 'provider-1',
          visit: { branchId: 'branch-1' },
          createdAt: { gte: expect.any(Date), lt: expect.any(Date) },
        }),
      }),
    );
  });

  it('does not allow a provider to start another provider item', async () => {
    const { service, prisma } = setup();
    prisma.serviceProviderProfile.findFirst.mockResolvedValue({ id: 'provider-2' });
    await expect(
      service.transitionItem(auth, 'visit-1', 'item-2', 'start', {} as RequestWithContext),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.visitItem.update).not.toHaveBeenCalled();
  });

  it('starts a second assigned item without changing the first in-progress item', async () => {
    const { service, prisma } = setup();
    await service.transitionItem(auth, 'visit-1', 'item-2', 'start', {} as RequestWithContext);
    expect(prisma.visitItem.update).toHaveBeenCalledTimes(1);
    expect(prisma.visitItem.update).toHaveBeenCalledWith({
      where: { id: 'item-2' },
      data: { status: VisitItemStatus.IN_PROGRESS, startedAt: expect.any(Date) },
    });
  });

  it('completes only the assigned in-progress item', async () => {
    const { service, prisma } = setup();
    await service.transitionItem(auth, 'visit-1', 'item-1', 'complete', {} as RequestWithContext);
    expect(prisma.visitItem.update).toHaveBeenCalledTimes(1);
    expect(prisma.visitItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { status: VisitItemStatus.COMPLETED, completedAt: expect.any(Date) },
    });
  });
});
