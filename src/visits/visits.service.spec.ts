import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma, TenantRole, VisitItemStatus, VisitStatus } from '@prisma/client';
import { Permission, TENANT_ROLE_PERMISSIONS } from '../authorization/permissions';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { VisitsService } from './visits.service';

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

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
  paymentStatus: PaymentStatus.UNPAID,
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
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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

describe('VisitsService receipt detail', () => {
  it('requests branch contact and timezone fields with the existing visit detail', async () => {
    const { service, prisma } = setup();
    await service.get({ ...auth, tenantRole: TenantRole.RECEPTIONIST }, visit.id);

    expect(prisma.visit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: visit.id, tenantId: auth.tenantId },
        include: expect.objectContaining({
          branch: {
            select: expect.objectContaining({
              name: true,
              phone: true,
              address: true,
              city: true,
              timezone: true,
            }),
          },
        }),
      }),
    );
  });

  it('allows receptionists to read visits but not service providers', () => {
    expect(TENANT_ROLE_PERMISSIONS.RECEPTIONIST).toContain(Permission.VISIT_READ);
    expect(TENANT_ROLE_PERMISSIONS.SERVICE_PROVIDER).not.toContain(Permission.VISIT_READ);
  });
});

describe('VisitsService payment recording', () => {
  const completedVisit = { ...visit, status: VisitStatus.COMPLETED };

  it('records server-authoritative payment metadata and an optional trimmed note', async () => {
    const { service, prisma } = setup();
    prisma.visit.findFirst.mockResolvedValue(completedVisit);
    const before = new Date();
    await service.markPaid(
      { ...auth, tenantRole: TenantRole.RECEPTIONIST },
      visit.id,
      { paymentNote: '  Cash received  ' },
      {} as RequestWithContext,
    );
    const data = (
      prisma.visit.updateMany.mock.calls[0][0] as {
        data: {
          paymentStatus: PaymentStatus;
          paidByUserId: string;
          paymentNote: string | null;
          paidAt: Date;
        };
      }
    ).data;
    expect(data).toEqual(
      expect.objectContaining({
        paymentStatus: PaymentStatus.PAID,
        paidByUserId: auth.userId,
        paymentNote: 'Cash received',
        paidAt: expect.any(Date),
      }),
    );
    expect(data.paidAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('stores an omitted payment note as null', async () => {
    const { service, prisma } = setup();
    prisma.visit.findFirst.mockResolvedValue(completedVisit);
    await service.markPaid(auth, visit.id, {}, {} as RequestWithContext);
    const call = prisma.visit.updateMany.mock.calls[0][0] as {
      data: { paymentNote: string | null };
    };
    expect(call.data.paymentNote).toBeNull();
  });

  it.each([VisitStatus.DRAFT, VisitStatus.IN_PROGRESS, VisitStatus.CANCELLED])(
    'rejects a %s visit',
    async (status) => {
      const { service, prisma } = setup();
      prisma.visit.findFirst.mockResolvedValue({ ...visit, status });
      await expect(
        service.markPaid(auth, visit.id, {}, {} as RequestWithContext),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.visit.updateMany).not.toHaveBeenCalled();
    },
  );

  it('does not overwrite an already paid visit', async () => {
    const { service, prisma } = setup();
    prisma.visit.findFirst.mockResolvedValue({
      ...completedVisit,
      paymentStatus: PaymentStatus.PAID,
    });
    await expect(
      service.markPaid(auth, visit.id, {}, {} as RequestWithContext),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.visit.updateMany).not.toHaveBeenCalled();
  });

  it('hides cross-tenant and inaccessible-branch visits as not found', async () => {
    const { service, prisma } = setup();
    prisma.visit.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(completedVisit);
    await expect(
      service.markPaid(auth, visit.id, {}, {} as RequestWithContext),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.markPaid(
        { ...auth, accessibleBranchIds: [] },
        visit.id,
        {},
        {} as RequestWithContext,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('grants payment recording to receptionists but not service providers', () => {
    expect(TENANT_ROLE_PERMISSIONS.RECEPTIONIST).toContain(Permission.VISIT_MARK_PAID);
    expect(TENANT_ROLE_PERMISSIONS.SERVICE_PROVIDER).not.toContain(Permission.VISIT_MARK_PAID);
  });
});
