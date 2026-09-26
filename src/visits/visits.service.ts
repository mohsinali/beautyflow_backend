import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TenantRole, VisitItemStatus, VisitStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { pageMeta } from '../common/dto/pagination.dto';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { ServiceProvidersService } from '../service-providers/service-providers.service';
import {
  CreateVisitDto,
  UpdateVisitDto,
  UpdateVisitItemDto,
  VisitItemInputDto,
  VisitListDto,
} from './dto/visit.dto';
import { calculateVisitTotals, validateItemMoney, validateVisitCompletion } from './visit-rules';

const detailInclude = {
  branch: { select: { id: true, name: true, code: true } },
  customer: { select: { id: true, name: true, phone: true } },
  defaultProvider: { select: { id: true, displayName: true } },
  items: {
    include: { provider: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.VisitInclude;

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly providers: ServiceProvidersService,
  ) {}

  async create(
    auth: AuthContext,
    branchId: string | undefined,
    dto: CreateVisitDto,
    request: RequestWithContext,
  ) {
    const tenantId = this.tenant(auth);
    if (!branchId) throw this.error('VISIT_BRANCH_REQUIRED', 'Select an active branch');
    await this.requireBranch(auth, branchId);
    await this.requireCustomer(tenantId, dto.customerId);
    if (dto.defaultProviderId)
      await this.requireBranchProvider(tenantId, branchId, dto.defaultProviderId);
    if (
      dto.items.some(
        (item) => item.chargedPrice !== undefined || item.discountAmount !== undefined,
      ) &&
      auth.tenantRole !== TenantRole.SALON_OWNER
    )
      throw new ForbiddenException('Insufficient permission');
    const items = await Promise.all(
      dto.items.map((item) => this.resolveItem(tenantId, branchId, item, dto.defaultProviderId)),
    );
    const totals = this.totals(items);
    const started = dto.status === VisitStatus.IN_PROGRESS;
    const visit = await this.prisma.$transaction(async (tx) => {
      const created = await tx.visit.create({
        data: {
          tenantId,
          branchId,
          customerId: dto.customerId,
          defaultProviderId: dto.defaultProviderId || null,
          notes: dto.notes?.trim() || null,
          status: started ? VisitStatus.IN_PROGRESS : VisitStatus.DRAFT,
          startedAt: started ? new Date() : null,
          createdByUserId: auth.userId,
          ...totals,
          items: { create: items },
        },
        include: detailInclude,
      });
      await this.audit.record(
        {
          action: 'VISIT_CREATED',
          entityType: 'Visit',
          entityId: created.id,
          tenantId,
          branchId,
          actorUserId: auth.userId,
          metadata: { status: created.status, itemCount: items.length },
          request,
        },
        tx,
      );
      return created;
    });
    return this.serialize(visit);
  }

  async list(auth: AuthContext, activeBranchId: string | undefined, query: VisitListDto) {
    const tenantId = this.tenant(auth);
    const branchId = query.branchId ?? activeBranchId;
    if (!branchId) throw this.error('VISIT_BRANCH_REQUIRED', 'Select an active branch');
    await this.requireBranch(auth, branchId);
    const where: Prisma.VisitWhereInput = {
      tenantId,
      branchId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { customer: { name: { contains: query.search, mode: 'insensitive' } } }
        : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.visit.findMany({
        where,
        include: detailInclude,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.visit.count({ where }),
    ]);
    return {
      items: items.map((item) => this.serialize(item)),
      meta: pageMeta(total, query.page, query.pageSize),
    };
  }

  async get(auth: AuthContext, id: string) {
    const visit = await this.requireVisit(auth, id);
    return this.serialize(visit);
  }

  async update(auth: AuthContext, id: string, dto: UpdateVisitDto, request: RequestWithContext) {
    const visit = await this.requireEditable(auth, id);
    if (dto.customerId) await this.requireCustomer(visit.tenantId, dto.customerId);
    if (dto.defaultProviderId)
      await this.requireBranchProvider(visit.tenantId, visit.branchId, dto.defaultProviderId);
    const updated = await this.prisma.visit.update({
      where: { id },
      data: {
        ...(dto.customerId ? { customerId: dto.customerId } : {}),
        ...(dto.defaultProviderId !== undefined
          ? { defaultProviderId: dto.defaultProviderId }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
      },
      include: detailInclude,
    });
    await this.audit.record({
      action: 'VISIT_UPDATED',
      entityType: 'Visit',
      entityId: id,
      tenantId: visit.tenantId,
      branchId: visit.branchId,
      actorUserId: auth.userId,
      metadata: { changedFields: Object.keys(dto) },
      request,
    });
    return this.serialize(updated);
  }

  async addItem(
    auth: AuthContext,
    id: string,
    dto: VisitItemInputDto,
    request: RequestWithContext,
  ) {
    const visit = await this.requireEditable(auth, id);
    if (
      (dto.chargedPrice !== undefined || dto.discountAmount !== undefined) &&
      auth.tenantRole !== TenantRole.SALON_OWNER
    )
      throw new ForbiddenException('Insufficient permission');
    const item = await this.resolveItem(
      visit.tenantId,
      visit.branchId,
      dto,
      visit.defaultProviderId,
    );
    const created = await this.prisma.$transaction(async (tx) => {
      const result = await tx.visitItem.create({
        data: { ...item, tenantId: visit.tenantId, visitId: id },
      });
      await this.recalculate(tx, id);
      await this.audit.record(
        {
          action: 'VISIT_ITEM_ADDED',
          entityType: 'VisitItem',
          entityId: result.id,
          tenantId: visit.tenantId,
          branchId: visit.branchId,
          actorUserId: auth.userId,
          metadata: { catalogServiceId: dto.catalogServiceId },
          request,
        },
        tx,
      );
      return result;
    });
    return {
      ...created,
      originalPrice: created.originalPrice.toFixed(2),
      chargedPrice: created.chargedPrice.toFixed(2),
      discountAmount: created.discountAmount.toFixed(2),
    };
  }

  async updateItem(
    auth: AuthContext,
    id: string,
    itemId: string,
    dto: UpdateVisitItemDto,
    request: RequestWithContext,
  ) {
    const visit = await this.requireEditable(auth, id);
    const item = visit.items.find((value) => value.id === itemId);
    if (!item) throw this.notFound('VISIT_ITEM_NOT_FOUND', 'Visit item not found');
    if (
      dto.providerId &&
      !(await this.providers.isEligible(
        visit.tenantId,
        visit.branchId,
        item.catalogServiceId,
        dto.providerId,
      ))
    )
      throw this.error(
        'VISIT_PROVIDER_NOT_ELIGIBLE',
        'Provider is not eligible for this treatment',
      );
    const changesMoney = dto.chargedPrice !== undefined || dto.discountAmount !== undefined;
    if (changesMoney && auth.tenantRole !== TenantRole.SALON_OWNER)
      throw new ForbiddenException('Insufficient permission');
    const chargedPrice = new Prisma.Decimal(dto.chargedPrice ?? item.chargedPrice);
    const discountAmount = new Prisma.Decimal(dto.discountAmount ?? item.discountAmount);
    this.validateMoney(chargedPrice, discountAmount);
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.visitItem.update({
        where: { id: itemId },
        data: {
          ...(dto.providerId !== undefined ? { providerId: dto.providerId } : {}),
          chargedPrice,
          discountAmount,
        },
      });
      await this.recalculate(tx, id);
      const changed = [
        dto.providerId !== undefined && 'provider',
        dto.chargedPrice !== undefined && 'price',
        dto.discountAmount !== undefined && 'discount',
      ].filter(Boolean);
      await this.audit.record(
        {
          action: 'VISIT_ITEM_UPDATED',
          entityType: 'VisitItem',
          entityId: itemId,
          tenantId: visit.tenantId,
          branchId: visit.branchId,
          actorUserId: auth.userId,
          metadata: { changed },
          request,
        },
        tx,
      );
      return result;
    });
    return updated;
  }

  async removeItem(auth: AuthContext, id: string, itemId: string, request: RequestWithContext) {
    const visit = await this.requireEditable(auth, id);
    const item = visit.items.find((value) => value.id === itemId);
    if (!item) throw this.notFound('VISIT_ITEM_NOT_FOUND', 'Visit item not found');
    await this.prisma.$transaction(async (tx) => {
      if (visit.status === VisitStatus.DRAFT) await tx.visitItem.delete({ where: { id: itemId } });
      else
        await tx.visitItem.update({
          where: { id: itemId },
          data: { status: VisitItemStatus.CANCELLED, cancelledAt: new Date() },
        });
      await this.recalculate(tx, id);
      await this.audit.record(
        {
          action:
            visit.status === VisitStatus.DRAFT ? 'VISIT_ITEM_REMOVED' : 'VISIT_ITEM_CANCELLED',
          entityType: 'VisitItem',
          entityId: itemId,
          tenantId: visit.tenantId,
          branchId: visit.branchId,
          actorUserId: auth.userId,
          request,
        },
        tx,
      );
    });
    return this.get(auth, id);
  }

  async transitionVisit(
    auth: AuthContext,
    id: string,
    action: 'start' | 'complete' | 'cancel',
    request: RequestWithContext,
  ) {
    const visit = await this.requireVisit(auth, id);
    if (action === 'start' && visit.status === VisitStatus.IN_PROGRESS)
      return this.serialize(visit);
    if (action === 'complete' && visit.status === VisitStatus.COMPLETED)
      return this.serialize(visit);
    if (action === 'cancel' && visit.status === VisitStatus.CANCELLED) return this.serialize(visit);
    if (action === 'start' && visit.status !== VisitStatus.DRAFT) throw this.invalidStatus();
    if (action === 'complete') {
      if (visit.status !== VisitStatus.IN_PROGRESS) throw this.invalidStatus();
      validateVisitCompletion(visit.items);
    }
    if (
      action === 'cancel' &&
      visit.status !== VisitStatus.DRAFT &&
      visit.status !== VisitStatus.IN_PROGRESS
    )
      throw this.invalidStatus();
    const now = new Date();
    const status =
      action === 'start'
        ? VisitStatus.IN_PROGRESS
        : action === 'complete'
          ? VisitStatus.COMPLETED
          : VisitStatus.CANCELLED;
    await this.prisma.$transaction(async (tx) => {
      await tx.visit.update({
        where: { id },
        data: {
          status,
          ...(action === 'start'
            ? { startedAt: now }
            : action === 'complete'
              ? { completedAt: now }
              : { cancelledAt: now }),
        },
      });
      await this.audit.record(
        {
          action: `VISIT_${action.toUpperCase()}${action === 'complete' ? 'D' : 'ED'}`,
          entityType: 'Visit',
          entityId: id,
          tenantId: visit.tenantId,
          branchId: visit.branchId,
          actorUserId: auth.userId,
          request,
        },
        tx,
      );
    });
    return this.get(auth, id);
  }

  async transitionItem(
    auth: AuthContext,
    id: string,
    itemId: string,
    action: 'start' | 'complete' | 'cancel',
    request: RequestWithContext,
  ) {
    const visit = await this.requireVisit(auth, id);
    if (visit.status !== VisitStatus.IN_PROGRESS) throw this.invalidStatus();
    const item = visit.items.find((value) => value.id === itemId);
    if (!item) throw this.notFound('VISIT_ITEM_NOT_FOUND', 'Visit item not found');
    const target =
      action === 'start'
        ? VisitItemStatus.IN_PROGRESS
        : action === 'complete'
          ? VisitItemStatus.COMPLETED
          : VisitItemStatus.CANCELLED;
    if (item.status === target) return this.serialize(visit);
    if (action === 'start' && item.status !== VisitItemStatus.PENDING) throw this.invalidStatus();
    if (
      action === 'complete' &&
      item.status !== VisitItemStatus.PENDING &&
      item.status !== VisitItemStatus.IN_PROGRESS
    )
      throw this.invalidStatus();
    if (
      action === 'cancel' &&
      item.status !== VisitItemStatus.PENDING &&
      item.status !== VisitItemStatus.IN_PROGRESS
    )
      throw this.invalidStatus();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.visitItem.update({
        where: { id: itemId },
        data: {
          status: target,
          ...(action === 'start'
            ? { startedAt: now }
            : action === 'complete'
              ? { completedAt: now }
              : { cancelledAt: now }),
        },
      });
      if (action === 'cancel') await this.recalculate(tx, id);
      await this.audit.record(
        {
          action: `VISIT_ITEM_${action.toUpperCase()}${action === 'complete' ? 'D' : 'ED'}`,
          entityType: 'VisitItem',
          entityId: itemId,
          tenantId: visit.tenantId,
          branchId: visit.branchId,
          actorUserId: auth.userId,
          request,
        },
        tx,
      );
    });
    return this.get(auth, id);
  }

  private async resolveItem(
    tenantId: string,
    branchId: string,
    dto: VisitItemInputDto,
    defaultProviderId?: string | null,
  ) {
    const service = await this.prisma.catalogService.findFirst({
      where: {
        id: dto.catalogServiceId,
        tenantId,
        isActive: true,
        deletedAt: null,
        category: { isActive: true, deletedAt: null },
      },
      include: { branchServices: { where: { branchId } } },
    });
    if (!service || service.branchServices[0]?.isAvailable === false)
      throw this.error('VISIT_SERVICE_UNAVAILABLE', 'Treatment is unavailable at this branch');
    const originalPrice = service.branchServices[0]?.priceOverride ?? service.defaultPrice;
    const chargedPrice = new Prisma.Decimal(dto.chargedPrice ?? originalPrice);
    const discountAmount = new Prisma.Decimal(dto.discountAmount ?? 0);
    this.validateMoney(chargedPrice, discountAmount);
    let providerId = dto.providerId || null;
    if (
      !providerId &&
      defaultProviderId &&
      (await this.providers.isEligible(tenantId, branchId, dto.catalogServiceId, defaultProviderId))
    )
      providerId = defaultProviderId;
    if (
      providerId &&
      !(await this.providers.isEligible(tenantId, branchId, dto.catalogServiceId, providerId))
    )
      throw this.error(
        'VISIT_PROVIDER_NOT_ELIGIBLE',
        'Provider is not eligible for this treatment',
      );
    return {
      catalogServiceId: dto.catalogServiceId,
      providerId,
      serviceNameSnapshot: service.name,
      originalPrice,
      chargedPrice,
      discountAmount,
    };
  }

  private totals(items: Array<{ chargedPrice: Prisma.Decimal; discountAmount: Prisma.Decimal }>) {
    return calculateVisitTotals(items);
  }
  private validateMoney(price: Prisma.Decimal, discount: Prisma.Decimal) {
    validateItemMoney(price, discount);
  }
  private async recalculate(tx: Prisma.TransactionClient, visitId: string) {
    const items = await tx.visitItem.findMany({
      where: { visitId, status: { not: VisitItemStatus.CANCELLED } },
      select: { chargedPrice: true, discountAmount: true },
    });
    await tx.visit.update({ where: { id: visitId }, data: this.totals(items) });
  }
  private async requireCustomer(tenantId: string, id: string) {
    const value = await this.prisma.customer.findFirst({
      where: { id, tenantId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!value) throw this.notFound('VISIT_CUSTOMER_NOT_FOUND', 'Customer not found');
  }
  private async requireBranchProvider(tenantId: string, branchId: string, providerId: string) {
    const value = await this.prisma.serviceProviderProfile.findFirst({
      where: {
        id: providerId,
        tenantId,
        isActive: true,
        deletedAt: null,
        membership: { status: 'ACTIVE', branchAssignments: { some: { branchId } } },
      },
      select: { id: true },
    });
    if (!value)
      throw this.error('VISIT_PROVIDER_NOT_ELIGIBLE', 'Provider is not active at this branch');
  }
  private async requireBranch(auth: AuthContext, id: string) {
    const tenantId = this.tenant(auth);
    const allowed =
      auth.tenantRole === TenantRole.SALON_OWNER || auth.accessibleBranchIds.includes(id);
    const value = allowed
      ? await this.prisma.branch.findFirst({
          where: { id, tenantId, isActive: true, deletedAt: null },
          select: { id: true },
        })
      : null;
    if (!value) throw this.notFound('VISIT_BRANCH_NOT_ACCESSIBLE', 'Branch not found');
  }
  private async requireVisit(auth: AuthContext, id: string) {
    const tenantId = this.tenant(auth);
    const visit = await this.prisma.visit.findFirst({
      where: { id, tenantId },
      include: detailInclude,
    });
    if (
      !visit ||
      (auth.tenantRole !== TenantRole.SALON_OWNER &&
        !auth.accessibleBranchIds.includes(visit.branchId))
    )
      throw this.notFound('VISIT_NOT_FOUND', 'Visit not found');
    return visit;
  }
  private async requireEditable(auth: AuthContext, id: string) {
    const visit = await this.requireVisit(auth, id);
    if (visit.status !== VisitStatus.DRAFT && visit.status !== VisitStatus.IN_PROGRESS)
      throw this.invalidStatus();
    return visit;
  }
  private serialize<
    T extends {
      subtotal: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      total: Prisma.Decimal;
      items: Array<{
        originalPrice: Prisma.Decimal;
        chargedPrice: Prisma.Decimal;
        discountAmount: Prisma.Decimal;
      }>;
    },
  >(visit: T) {
    return {
      ...visit,
      subtotal: visit.subtotal.toFixed(2),
      discountAmount: visit.discountAmount.toFixed(2),
      total: visit.total.toFixed(2),
      items: visit.items.map((item) => ({
        ...item,
        originalPrice: item.originalPrice.toFixed(2),
        chargedPrice: item.chargedPrice.toFixed(2),
        discountAmount: item.discountAmount.toFixed(2),
        finalAmount: item.chargedPrice.sub(item.discountAmount).toFixed(2),
      })),
    };
  }
  private tenant(auth: AuthContext) {
    if (!auth.tenantId) throw this.notFound('TENANT_CONTEXT_NOT_FOUND', 'Tenant context not found');
    return auth.tenantId;
  }
  private invalidStatus() {
    return this.error('VISIT_INVALID_STATUS', 'Visit status does not allow this action');
  }
  private error(code: string, message: string) {
    return new BadRequestException({ code, message });
  }
  private notFound(code: string, message: string) {
    return new NotFoundException({ code, message });
  }
}
