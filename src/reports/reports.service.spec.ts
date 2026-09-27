import { Prisma, TenantRole } from '@prisma/client';
import type { AuthContext } from '../common/types/request-context';
import { ReportsService } from './reports.service';
import { Permission, TENANT_ROLE_PERMISSIONS } from '../authorization/permissions';

const auth: AuthContext = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'owner@example.com',
  firstName: 'Owner',
  lastName: 'One',
  platformRole: null,
  tenantId: '00000000-0000-4000-8000-000000000010',
  tenantSlug: 'salon',
  membershipId: '00000000-0000-4000-8000-000000000011',
  tenantRole: TenantRole.SALON_OWNER,
  sessionId: 'session',
  accessibleBranchIds: [],
};
const branch = {
  id: '00000000-0000-4000-8000-000000000020',
  timezone: 'Asia/Karachi',
  tenant: { timezone: 'UTC' },
};

describe('ReportsService', () => {
  const prisma = {
    branch: { findMany: jest.fn() },
    serviceProviderProfile: { findFirst: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const service = new ReportsService(prisma as never);
  const queryAt = (index: number) => {
    const calls = prisma.$queryRaw.mock.calls as unknown as Array<
      [{ strings: string[]; values: unknown[] }]
    >;
    return calls[index]![0];
  };
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.branch.findMany.mockResolvedValue([branch]);
  });

  it('serializes dashboard aggregates and keeps exact stored decimal revenue', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          visits: 2n,
          completedVisits: 0n,
          completedTreatments: 3n,
          revenueRecorded: new Prisma.Decimal('125.40'),
          paidVisits: 1n,
          unpaidCompletedVisits: 1n,
          activeVisits: 1n,
          completedToday: 0n,
        },
      ])
      .mockResolvedValueOnce([{ name: 'Haircut', treatmentsCompleted: 3n }])
      .mockResolvedValueOnce([]);
    const result = await service.dashboard(auth, { branchId: branch.id });
    expect(result.summary).toMatchObject({
      visitsToday: 2,
      completedTreatmentsToday: 3,
      revenueRecordedToday: '125.40',
      unpaidCompletedVisits: 1,
    });
    expect(result.topTreatments).toEqual([{ name: 'Haircut', treatmentsCompleted: 3 }]);
  });

  it('attributes provider metrics from VisitItem providerId and distinct visitId', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await service.providerPerformance(auth, {
      branchId: branch.id,
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
    });
    const sql = queryAt(0).strings.join(' ');
    expect(sql).toContain('vi."providerId"');
    expect(sql).toContain('COUNT(DISTINCT vi."visitId")');
    expect(sql).not.toContain('defaultProviderId');
  });

  it('always tenant-scopes provider aggregation and uses historical item amounts', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await service.providerPerformance(auth, {
      scope: 'all',
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
    });
    const query = queryAt(0);
    expect(query.strings.join(' ')).toContain('vi."tenantId"=');
    expect(query.strings.join(' ')).toContain('vi."chargedPrice"-vi."discountAmount"');
    expect(query.values).toContain(auth.tenantId);
  });

  it('uses the selected branch only and branch-local date boundaries', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await service.providerPerformance(auth, {
      branchId: branch.id,
      fromDate: '2026-09-01',
      toDate: '2026-09-01',
    });
    const branchCalls = prisma.branch.findMany.mock.calls as unknown as Array<
      [{ where: { tenantId: string; id?: string } }]
    >;
    expect(branchCalls[0]![0].where).toMatchObject({ tenantId: auth.tenantId, id: branch.id });
    const values = queryAt(0).values;
    expect(
      values.some(
        (value) => value instanceof Date && value.toISOString() === '2026-08-31T19:00:00.000Z',
      ),
    ).toBe(true);
    expect(
      values.some(
        (value) => value instanceof Date && value.toISOString() === '2026-09-01T19:00:00.000Z',
      ),
    ).toBe(true);
  });

  it('does not grant owner financial reports to receptionist or service provider roles', () => {
    expect(TENANT_ROLE_PERMISSIONS.RECEPTIONIST).not.toContain(Permission.REPORT_FINANCIAL_VIEW);
    expect(TENANT_ROLE_PERMISSIONS.SERVICE_PROVIDER).not.toContain(Permission.REPORT_VIEW);
  });

  it('accepts PostgreSQL date strings in the salon daily breakdown', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          visits: 2n,
          completedVisits: 1n,
          completedTreatments: 3n,
          revenueRecorded: new Prisma.Decimal('90.00'),
          paidVisits: 1n,
          unpaidCompletedVisits: 0n,
        },
      ])
      .mockResolvedValueOnce([
        {
          date: '2026-09-01',
          visits: 2n,
          treatments: 3n,
          revenue: new Prisma.Decimal('90.00'),
        },
      ]);

    const result = await service.salonPerformance(auth, {
      branchId: branch.id,
      fromDate: '2026-09-01',
      toDate: '2026-09-01',
    });

    expect(result.breakdown).toEqual([
      { date: '2026-09-01', visits: 2, treatments: 3, revenue: '90.00' },
    ]);
    const breakdownSql = queryAt(1).strings.join(' ');
    expect(breakdownSql).toContain('AS "reportDate"');
    expect(breakdownSql).toContain('GROUP BY data."reportDate"');
    expect(breakdownSql).not.toMatch(/\bGROUP BY day\b/);
  });

  it('returns an empty salon daily breakdown when the date range has no data', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          visits: 0n,
          completedVisits: 0n,
          completedTreatments: 0n,
          revenueRecorded: new Prisma.Decimal(0),
          paidVisits: 0n,
          unpaidCompletedVisits: 0n,
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.salonPerformance(auth, {
      branchId: branch.id,
      fromDate: '2025-01-01',
      toDate: '2025-01-01',
    });

    expect(result.breakdown).toEqual([]);
  });
});
