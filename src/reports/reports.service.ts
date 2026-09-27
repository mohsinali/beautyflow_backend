import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TenantRole } from '@prisma/client';
import type { AuthContext } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ProviderPerformanceDto,
  ReportRangeDto,
  ReportScopeDto,
  ServicePerformanceDto,
} from './dto/report.dto';

type BranchWindow = { id: string; timezone: string; from: Date; to: Date };
type SummaryRow = {
  visits: bigint;
  completedVisits: bigint;
  completedTreatments: bigint;
  revenueRecorded: Prisma.Decimal | null;
  paidVisits: bigint;
  unpaidCompletedVisits: bigint;
};

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(auth: AuthContext, query: ReportScopeDto) {
    const tenantId = this.tenant(auth);
    const windows = await this.windows(auth, query);
    const summaries = await this.prisma.$queryRaw<
      Array<
        SummaryRow & {
          activeVisits: bigint;
          completedToday: bigint;
        }
      >
    >(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM "Visit" v WHERE v."tenantId" = ${tenantId}::uuid AND ${this.branchPredicate(windows, 'v', 'createdAt')}) AS visits,
        0::bigint AS "completedVisits",
        (SELECT COUNT(*) FROM "VisitItem" vi JOIN "Visit" v ON v.id = vi."visitId" AND v."tenantId" = vi."tenantId"
          WHERE vi."tenantId" = ${tenantId}::uuid AND vi.status = 'COMPLETED' AND ${this.branchPredicate(windows, 'v', 'completedAt', 'vi')}) AS "completedTreatments",
        (SELECT COALESCE(SUM(v.total), 0) FROM "Visit" v WHERE v."tenantId" = ${tenantId}::uuid AND v."paymentStatus" = 'PAID' AND ${this.branchPredicate(windows, 'v', 'paidAt')}) AS "revenueRecorded",
        (SELECT COUNT(*) FROM "Visit" v WHERE v."tenantId" = ${tenantId}::uuid AND v."paymentStatus" = 'PAID' AND ${this.branchPredicate(windows, 'v', 'paidAt')}) AS "paidVisits",
        (SELECT COUNT(*) FROM "Visit" v WHERE v."tenantId" = ${tenantId}::uuid AND v.status = 'COMPLETED' AND v."paymentStatus" = 'UNPAID' AND v."branchId" IN (${Prisma.join(windows.map((w) => Prisma.sql`${w.id}::uuid`))})) AS "unpaidCompletedVisits",
        (SELECT COUNT(*) FROM "Visit" v WHERE v."tenantId" = ${tenantId}::uuid AND v.status IN ('DRAFT','IN_PROGRESS') AND v."branchId" IN (${Prisma.join(windows.map((w) => Prisma.sql`${w.id}::uuid`))})) AS "activeVisits",
        0::bigint AS "completedToday"
    `);
    const summary = summaries[0];
    if (!summary) throw new Error('Dashboard aggregation returned no row');
    const [topTreatments, topProviders] = await Promise.all([
      this.topTreatments(tenantId, windows),
      this.providerRows(tenantId, windows, undefined, 5),
    ]);
    return {
      summary: {
        visitsToday: Number(summary.visits),
        completedTreatmentsToday: Number(summary.completedTreatments),
        revenueRecordedToday: this.money(summary.revenueRecorded),
        activeVisits: Number(summary.activeVisits),
        paidVisitsToday: Number(summary.paidVisits),
        unpaidCompletedVisits: Number(summary.unpaidCompletedVisits),
      },
      topTreatments,
      topProviders,
    };
  }

  async salonPerformance(auth: AuthContext, query: ReportRangeDto) {
    this.validateRange(query);
    const tenantId = this.tenant(auth);
    const windows = await this.windows(auth, query, query.fromDate, query.toDate);
    const summaries = await this.prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM "Visit" v WHERE v."tenantId"=${tenantId}::uuid AND ${this.branchPredicate(windows, 'v', 'createdAt')}) AS visits,
        (SELECT COUNT(*) FROM "Visit" v WHERE v."tenantId"=${tenantId}::uuid AND v.status='COMPLETED' AND ${this.branchPredicate(windows, 'v', 'completedAt')}) AS "completedVisits",
        (SELECT COUNT(*) FROM "VisitItem" vi JOIN "Visit" v ON v.id=vi."visitId" AND v."tenantId"=vi."tenantId" WHERE vi."tenantId"=${tenantId}::uuid AND vi.status='COMPLETED' AND ${this.branchPredicate(windows, 'v', 'completedAt', 'vi')}) AS "completedTreatments",
        (SELECT COALESCE(SUM(v.total),0) FROM "Visit" v WHERE v."tenantId"=${tenantId}::uuid AND v."paymentStatus"='PAID' AND ${this.branchPredicate(windows, 'v', 'paidAt')}) AS "revenueRecorded",
        (SELECT COUNT(*) FROM "Visit" v WHERE v."tenantId"=${tenantId}::uuid AND v."paymentStatus"='PAID' AND ${this.branchPredicate(windows, 'v', 'paidAt')}) AS "paidVisits",
        (SELECT COUNT(*) FROM "Visit" v WHERE v."tenantId"=${tenantId}::uuid AND v.status='COMPLETED' AND v."paymentStatus"='UNPAID' AND ${this.branchPredicate(windows, 'v', 'completedAt')}) AS "unpaidCompletedVisits"
    `);
    const summary = summaries[0];
    if (!summary) throw new Error('Salon aggregation returned no row');
    const breakdown = await this.dailyBreakdown(tenantId, windows);
    const revenue = summary.revenueRecorded ?? new Prisma.Decimal(0);
    return {
      summary: {
        visits: Number(summary.visits),
        completedVisits: Number(summary.completedVisits),
        completedTreatments: Number(summary.completedTreatments),
        revenueRecorded: this.money(revenue),
        paidVisits: Number(summary.paidVisits),
        unpaidCompletedVisits: Number(summary.unpaidCompletedVisits),
        averageVisitValue: summary.paidVisits
          ? this.money(revenue.div(Number(summary.paidVisits)))
          : null,
      },
      breakdown,
    };
  }

  async providerPerformance(auth: AuthContext, query: ProviderPerformanceDto) {
    this.validateRange(query);
    const tenantId = this.tenant(auth);
    const windows = await this.windows(auth, query, query.fromDate, query.toDate);
    if (query.providerId) await this.requireProvider(tenantId, query.providerId);
    return { items: await this.providerRows(tenantId, windows, query.providerId) };
  }

  async servicePerformance(auth: AuthContext, query: ServicePerformanceDto) {
    this.validateRange(query);
    const tenantId = this.tenant(auth);
    const windows = await this.windows(auth, query, query.fromDate, query.toDate);
    const filters = [
      query.serviceId
        ? Prisma.sql`AND vi."catalogServiceId"=${query.serviceId}::uuid`
        : Prisma.empty,
      query.categoryId ? Prisma.sql`AND cs."categoryId"=${query.categoryId}::uuid` : Prisma.empty,
    ];
    const rows = await this.prisma.$queryRaw<
      Array<{
        serviceId: string;
        serviceName: string;
        categoryId: string;
        categoryName: string;
        treatmentsCompleted: bigint;
        uniqueVisits: bigint;
        revenueHandled: Prisma.Decimal;
      }>
    >(Prisma.sql`
      SELECT vi."catalogServiceId" AS "serviceId", vi."serviceNameSnapshot" AS "serviceName",
        cs."categoryId", sc.name AS "categoryName", COUNT(*) AS "treatmentsCompleted",
        COUNT(DISTINCT vi."visitId") AS "uniqueVisits",
        COALESCE(SUM(vi."chargedPrice" - vi."discountAmount"),0) AS "revenueHandled"
      FROM "VisitItem" vi JOIN "Visit" v ON v.id=vi."visitId" AND v."tenantId"=vi."tenantId"
      JOIN "CatalogService" cs ON cs.id=vi."catalogServiceId" AND cs."tenantId"=vi."tenantId"
      JOIN "ServiceCategory" sc ON sc.id=cs."categoryId" AND sc."tenantId"=cs."tenantId"
      WHERE vi."tenantId"=${tenantId}::uuid AND vi.status='COMPLETED'
        AND ${this.branchPredicate(windows, 'v', 'completedAt', 'vi')} ${Prisma.join(filters, ' ')}
      GROUP BY vi."catalogServiceId", vi."serviceNameSnapshot", cs."categoryId", sc.name
      ORDER BY "treatmentsCompleted" DESC, "serviceName" ASC
    `);
    return {
      items: rows.map((row) => ({
        ...row,
        treatmentsCompleted: Number(row.treatmentsCompleted),
        uniqueVisits: Number(row.uniqueVisits),
        revenueHandled: this.money(row.revenueHandled),
        averageTreatmentValue: row.treatmentsCompleted
          ? this.money(row.revenueHandled.div(Number(row.treatmentsCompleted)))
          : null,
      })),
    };
  }

  private async providerRows(
    tenantId: string,
    windows: BranchWindow[],
    providerId?: string,
    limit?: number,
  ) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        providerId: string;
        providerName: string;
        uniqueVisits: bigint;
        treatmentsCompleted: bigint;
        cancelledTreatments: bigint;
        revenueHandled: Prisma.Decimal;
        mostPerformedTreatment: string | null;
      }>
    >(Prisma.sql`
      WITH activity AS (
        SELECT vi."providerId", COUNT(DISTINCT vi."visitId") FILTER (WHERE vi.status='COMPLETED' AND ${this.branchPredicate(windows, 'v', 'completedAt', 'vi')}) AS "uniqueVisits",
          COUNT(*) FILTER (WHERE vi.status='COMPLETED' AND ${this.branchPredicate(windows, 'v', 'completedAt', 'vi')}) AS "treatmentsCompleted",
          COUNT(*) FILTER (WHERE vi.status='CANCELLED' AND ${this.branchPredicate(windows, 'v', 'cancelledAt', 'vi')}) AS "cancelledTreatments",
          COALESCE(SUM(vi."chargedPrice"-vi."discountAmount") FILTER (WHERE vi.status='COMPLETED' AND ${this.branchPredicate(windows, 'v', 'completedAt', 'vi')}),0) AS "revenueHandled"
        FROM "VisitItem" vi JOIN "Visit" v ON v.id=vi."visitId" AND v."tenantId"=vi."tenantId"
        WHERE vi."tenantId"=${tenantId}::uuid AND vi."providerId" IS NOT NULL ${providerId ? Prisma.sql`AND vi."providerId"=${providerId}::uuid` : Prisma.empty}
        GROUP BY vi."providerId"
      ), top_treatment AS (
        SELECT vi."providerId", vi."serviceNameSnapshot", ROW_NUMBER() OVER (PARTITION BY vi."providerId" ORDER BY COUNT(*) DESC, vi."serviceNameSnapshot") rank
        FROM "VisitItem" vi JOIN "Visit" v ON v.id=vi."visitId" AND v."tenantId"=vi."tenantId"
        WHERE vi."tenantId"=${tenantId}::uuid AND vi.status='COMPLETED' AND vi."providerId" IS NOT NULL AND ${this.branchPredicate(windows, 'v', 'completedAt', 'vi')}
        GROUP BY vi."providerId", vi."serviceNameSnapshot"
      )
      SELECT a."providerId", p."displayName" AS "providerName", a."uniqueVisits", a."treatmentsCompleted", a."cancelledTreatments", a."revenueHandled", tt."serviceNameSnapshot" AS "mostPerformedTreatment"
      FROM activity a JOIN "ServiceProviderProfile" p ON p.id=a."providerId" AND p."tenantId"=${tenantId}::uuid
      LEFT JOIN top_treatment tt ON tt."providerId"=a."providerId" AND tt.rank=1
      WHERE a."treatmentsCompleted">0 OR a."cancelledTreatments">0
      ORDER BY a."treatmentsCompleted" DESC, p."displayName" ASC ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}
    `);
    return rows.map((row) => ({
      ...row,
      uniqueVisits: Number(row.uniqueVisits),
      treatmentsCompleted: Number(row.treatmentsCompleted),
      cancelledTreatments: Number(row.cancelledTreatments),
      revenueHandled: this.money(row.revenueHandled),
      averageTreatmentValue: row.treatmentsCompleted
        ? this.money(row.revenueHandled.div(Number(row.treatmentsCompleted)))
        : null,
    }));
  }

  private async topTreatments(tenantId: string, windows: BranchWindow[]) {
    const rows = await this.prisma.$queryRaw<
      Array<{ name: string; treatmentsCompleted: bigint }>
    >(Prisma.sql`
      SELECT vi."serviceNameSnapshot" AS name, COUNT(*) AS "treatmentsCompleted"
      FROM "VisitItem" vi JOIN "Visit" v ON v.id=vi."visitId" AND v."tenantId"=vi."tenantId"
      WHERE vi."tenantId"=${tenantId}::uuid AND vi.status='COMPLETED' AND ${this.branchPredicate(windows, 'v', 'completedAt', 'vi')}
      GROUP BY vi."serviceNameSnapshot" ORDER BY "treatmentsCompleted" DESC, name ASC LIMIT 5
    `);
    return rows.map((row) => ({
      name: row.name,
      treatmentsCompleted: Number(row.treatmentsCompleted),
    }));
  }

  private async dailyBreakdown(tenantId: string, windows: BranchWindow[]) {
    const parts = await Promise.all(
      windows.map((window) =>
        this.prisma.$queryRaw<
          Array<{
            date: Date | string;
            visits: bigint;
            treatments: bigint;
            revenue: Prisma.Decimal;
          }>
        >(Prisma.sql`
        SELECT data."reportDate"::date AS date, SUM(visits)::bigint AS visits, SUM(treatments)::bigint AS treatments, SUM(revenue) AS revenue FROM (
          SELECT DATE(v."createdAt" AT TIME ZONE ${window.timezone}) AS "reportDate", COUNT(*) visits, 0::bigint treatments, 0::numeric revenue
          FROM "Visit" v WHERE v."tenantId"=${tenantId}::uuid AND v."branchId"=${window.id}::uuid AND v."createdAt">=${window.from} AND v."createdAt"<${window.to} GROUP BY 1
          UNION ALL SELECT DATE(vi."completedAt" AT TIME ZONE ${window.timezone}), 0, COUNT(*), 0 FROM "VisitItem" vi JOIN "Visit" v ON v.id=vi."visitId" AND v."tenantId"=vi."tenantId" WHERE vi."tenantId"=${tenantId}::uuid AND v."branchId"=${window.id}::uuid AND vi.status='COMPLETED' AND vi."completedAt">=${window.from} AND vi."completedAt"<${window.to} GROUP BY 1
          UNION ALL SELECT DATE(v."paidAt" AT TIME ZONE ${window.timezone}), 0, 0, SUM(v.total) FROM "Visit" v WHERE v."tenantId"=${tenantId}::uuid AND v."branchId"=${window.id}::uuid AND v."paymentStatus"='PAID' AND v."paidAt">=${window.from} AND v."paidAt"<${window.to} GROUP BY 1
        ) data GROUP BY data."reportDate" ORDER BY data."reportDate"
      `),
      ),
    );
    const combined = new Map<
      string,
      { visits: number; treatments: number; revenue: Prisma.Decimal }
    >();
    for (const row of parts.flat()) {
      const date =
        row.date instanceof Date ? row.date.toISOString().slice(0, 10) : row.date.slice(0, 10);
      const current = combined.get(date) ?? {
        visits: 0,
        treatments: 0,
        revenue: new Prisma.Decimal(0),
      };
      current.visits += Number(row.visits);
      current.treatments += Number(row.treatments);
      current.revenue = current.revenue.add(row.revenue);
      combined.set(date, current);
    }
    return [...combined]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, row]) => ({ ...row, date, revenue: this.money(row.revenue) }));
  }

  private branchPredicate(
    windows: BranchWindow[],
    visitAlias: string,
    field: string,
    timestampAlias = visitAlias,
  ) {
    return Prisma.sql`(${Prisma.join(
      windows.map(
        (w) =>
          Prisma.sql`(${Prisma.raw(`"${visitAlias}"."branchId"`)}=${w.id}::uuid AND ${Prisma.raw(`"${timestampAlias}"."${field}"`)}>=${w.from} AND ${Prisma.raw(`"${timestampAlias}"."${field}"`)}<${w.to})`,
      ),
      ' OR ',
    )})`;
  }

  private async windows(
    auth: AuthContext,
    query: ReportScopeDto,
    fromDate?: string,
    toDate?: string,
  ) {
    const tenantId = this.tenant(auth);
    if (!query.branchId && query.scope !== 'all')
      throw new BadRequestException('Select a report branch or All Branches');
    if (query.scope === 'all' && auth.tenantRole !== TenantRole.SALON_OWNER)
      throw new NotFoundException('Branch not found');
    const branches = await this.prisma.branch.findMany({
      where: {
        tenantId,
        isActive: true,
        deletedAt: null,
        ...(query.branchId ? { id: query.branchId } : {}),
      },
      select: { id: true, timezone: true, tenant: { select: { timezone: true } } },
    });
    if (!branches.length || (query.branchId && branches[0]?.id !== query.branchId))
      throw new NotFoundException('Branch not found');
    return branches.map((branch) => {
      const timezone = branch.timezone ?? branch.tenant.timezone;
      const today = this.localDate(new Date(), timezone);
      return {
        id: branch.id,
        timezone,
        from: this.zonedDateToUtc(fromDate ?? today, timezone),
        to: this.zonedDateToUtc(this.nextDate(toDate ?? today), timezone),
      };
    });
  }

  private validateRange(query: ReportRangeDto) {
    if (query.fromDate > query.toDate)
      throw new BadRequestException('fromDate must be on or before toDate');
  }
  private tenant(auth: AuthContext) {
    if (!auth.tenantId) throw new NotFoundException('Tenant not found');
    return auth.tenantId;
  }
  private async requireProvider(tenantId: string, id: string) {
    if (
      !(await this.prisma.serviceProviderProfile.findFirst({
        where: { id, tenantId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Service provider not found');
  }
  private money(value: Prisma.Decimal | null) {
    return (value ?? new Prisma.Decimal(0)).toFixed(2);
  }
  private localDate(value: Date, timeZone: string) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
  }
  private nextDate(date: string) {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + 1);
    return value.toISOString().slice(0, 10);
  }
  private zonedDateToUtc(date: string, timeZone: string) {
    const desired = new Date(`${date}T00:00:00Z`).getTime();
    let guess = desired;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date(guess));
      const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      guess +=
        desired -
        Date.UTC(
          Number(p.year),
          Number(p.month) - 1,
          Number(p.day),
          Number(p.hour),
          Number(p.minute),
          Number(p.second),
        );
    }
    return new Date(guess);
  }
}
