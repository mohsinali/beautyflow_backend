import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TenantRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  cleanText,
  decimalString,
  escapeLikeSearch,
  normalizeCode,
  normalizeName,
} from '../common/catalog-values';
import { pageMeta } from '../common/dto/pagination.dto';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';
import {
  CatalogServiceListDto,
  CategoryListDto,
  ConfigureBranchServiceDto,
  CreateCatalogServiceDto,
  CreateServiceCategoryDto,
  UpdateCatalogServiceDto,
  UpdateServiceCategoryDto,
} from './dto/service-catalog.dto';

const categorySelect = {
  id: true,
  name: true,
  description: true,
  color: true,
  iconKey: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ServiceCategorySelect;

const serviceSelect = {
  id: true,
  categoryId: true,
  name: true,
  description: true,
  code: true,
  defaultPrice: true,
  durationMinutes: true,
  color: true,
  iconKey: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, isActive: true } },
  branchServices: {
    select: { branchId: true, priceOverride: true, isAvailable: true },
  },
} satisfies Prisma.CatalogServiceSelect;

@Injectable()
export class ServiceCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createCategory(
    tenantId: string,
    dto: CreateServiceCategoryDto,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    try {
      const item = await this.prisma.serviceCategory.create({
        data: {
          tenantId,
          ...dto,
          name: cleanText(dto.name),
          normalizedName: normalizeName(dto.name),
        },
        select: categorySelect,
      });
      await this.audit.record({
        action: 'SERVICE_CATEGORY_CREATED',
        entityType: 'ServiceCategory',
        entityId: item.id,
        tenantId,
        actorUserId: actor.userId,
        request,
      });
      return item;
    } catch (error) {
      this.handleUnique(
        error,
        'SERVICE_CATEGORY_NAME_EXISTS',
        'Service category name already exists',
      );
    }
  }

  async listCategories(auth: AuthContext, query: CategoryListDto) {
    const tenantId = this.tenant(auth);
    const where: Prisma.ServiceCategoryWhereInput = {
      tenantId,
      deletedAt: null,
      isActive: auth.tenantRole === TenantRole.SALON_OWNER ? (query.isActive ?? true) : true,
      ...(query.search
        ? { name: { contains: escapeLikeSearch(query.search), mode: 'insensitive' } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.serviceCategory.findMany({
        where,
        select: categorySelect,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.serviceCategory.count({ where }),
    ]);
    return { items, meta: pageMeta(total, query.page, query.pageSize) };
  }

  async getCategory(auth: AuthContext, categoryId: string) {
    const tenantId = this.tenant(auth);
    const item = await this.prisma.serviceCategory.findFirst({
      where: {
        id: categoryId,
        tenantId,
        deletedAt: null,
        ...(auth.tenantRole === TenantRole.SALON_OWNER ? {} : { isActive: true }),
      },
      select: categorySelect,
    });
    if (!item) throw this.notFound('SERVICE_CATEGORY_NOT_FOUND', 'Service category not found');
    return item;
  }

  async updateCategory(
    tenantId: string,
    categoryId: string,
    dto: UpdateServiceCategoryDto,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    const before = await this.findCategory(tenantId, categoryId);
    try {
      const item = await this.prisma.serviceCategory.update({
        where: { id: categoryId },
        data: {
          ...dto,
          ...(dto.name === undefined
            ? {}
            : { name: cleanText(dto.name), normalizedName: normalizeName(dto.name) }),
        },
        select: categorySelect,
      });
      await this.audit.record({
        action: 'SERVICE_CATEGORY_UPDATED',
        entityType: 'ServiceCategory',
        entityId: item.id,
        tenantId,
        actorUserId: actor.userId,
        metadata: { changedFields: Object.keys(dto), previousName: before.name },
        request,
      });
      return item;
    } catch (error) {
      this.handleUnique(
        error,
        'SERVICE_CATEGORY_NAME_EXISTS',
        'Service category name already exists',
      );
    }
  }

  async setCategoryActive(
    tenantId: string,
    categoryId: string,
    isActive: boolean,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.findCategory(tenantId, categoryId);
    let item;
    try {
      item = await this.prisma.serviceCategory.update({
        where: { id: categoryId },
        data: { isActive },
        select: categorySelect,
      });
    } catch (error) {
      this.handleUnique(
        error,
        'SERVICE_CATEGORY_NAME_EXISTS',
        'An active service category with this name already exists',
      );
    }
    await this.audit.record({
      action: isActive ? 'SERVICE_CATEGORY_REACTIVATED' : 'SERVICE_CATEGORY_DEACTIVATED',
      entityType: 'ServiceCategory',
      entityId: item.id,
      tenantId,
      actorUserId: actor.userId,
      request,
    });
    return item;
  }

  async createService(
    tenantId: string,
    dto: CreateCatalogServiceDto,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.requireCategory(tenantId, dto.categoryId);
    try {
      const item = await this.prisma.catalogService.create({
        data: {
          ...dto,
          tenantId,
          name: cleanText(dto.name),
          normalizedName: normalizeName(dto.name),
          code: normalizeCode(dto.code),
          defaultPrice: new Prisma.Decimal(dto.defaultPrice),
        },
        select: serviceSelect,
      });
      await this.audit.record({
        action: 'CATALOG_SERVICE_CREATED',
        entityType: 'CatalogService',
        entityId: item.id,
        tenantId,
        actorUserId: actor.userId,
        metadata: { defaultPrice: decimalString(item.defaultPrice) },
        request,
      });
      return this.serializeService(item);
    } catch (error) {
      this.handleServiceUnique(error);
    }
  }

  async listServices(auth: AuthContext, query: CatalogServiceListDto) {
    const tenantId = this.tenant(auth);
    if (query.branchId) await this.requireBranch(auth, query.branchId);
    const isActive = auth.tenantRole === TenantRole.SALON_OWNER ? (query.isActive ?? true) : true;
    const search = query.search ? escapeLikeSearch(query.search) : undefined;
    const where: Prisma.CatalogServiceWhereInput = {
      tenantId,
      deletedAt: null,
      isActive,
      ...(isActive === false ? {} : { category: { isActive: true, deletedAt: null } }),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.minPrice !== undefined || query.maxPrice !== undefined
        ? {
            defaultPrice: {
              ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
              ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.catalogService.findMany({
        where,
        select: serviceSelect,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.catalogService.count({ where }),
    ]);
    return {
      items: items.map((item) => this.serializeService(item, query.branchId)),
      meta: pageMeta(total, query.page, query.pageSize),
    };
  }

  async getService(auth: AuthContext, serviceId: string, branchId?: string) {
    const tenantId = this.tenant(auth);
    if (branchId) await this.requireBranch(auth, branchId);
    const item = await this.prisma.catalogService.findFirst({
      where: {
        id: serviceId,
        tenantId,
        deletedAt: null,
        ...(auth.tenantRole === TenantRole.SALON_OWNER
          ? {}
          : { isActive: true, category: { isActive: true, deletedAt: null } }),
      },
      select: serviceSelect,
    });
    if (!item) throw this.notFound('CATALOG_SERVICE_NOT_FOUND', 'Catalog service not found');
    return this.serializeService(item, branchId);
  }

  async updateService(
    tenantId: string,
    serviceId: string,
    dto: UpdateCatalogServiceDto,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    const before = await this.findService(tenantId, serviceId);
    if (dto.categoryId) await this.requireCategory(tenantId, dto.categoryId);
    try {
      const item = await this.prisma.catalogService.update({
        where: { id: serviceId },
        data: {
          ...dto,
          ...(dto.name === undefined
            ? {}
            : { name: cleanText(dto.name), normalizedName: normalizeName(dto.name) }),
          ...(dto.code === undefined ? {} : { code: normalizeCode(dto.code) }),
          ...(dto.defaultPrice === undefined
            ? {}
            : { defaultPrice: new Prisma.Decimal(dto.defaultPrice) }),
        },
        select: serviceSelect,
      });
      await this.audit.record({
        action: 'CATALOG_SERVICE_UPDATED',
        entityType: 'CatalogService',
        entityId: item.id,
        tenantId,
        actorUserId: actor.userId,
        metadata: {
          changedFields: Object.keys(dto),
          ...(dto.defaultPrice === undefined
            ? {}
            : {
                previousDefaultPrice: decimalString(before.defaultPrice),
                defaultPrice: decimalString(item.defaultPrice),
              }),
        },
        request,
      });
      return this.serializeService(item);
    } catch (error) {
      this.handleServiceUnique(error);
    }
  }

  async setServiceActive(
    tenantId: string,
    serviceId: string,
    isActive: boolean,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.findService(tenantId, serviceId);
    let item;
    try {
      item = await this.prisma.catalogService.update({
        where: { id: serviceId },
        data: { isActive },
        select: serviceSelect,
      });
    } catch (error) {
      this.handleServiceUnique(error);
    }
    await this.audit.record({
      action: isActive ? 'CATALOG_SERVICE_REACTIVATED' : 'CATALOG_SERVICE_DEACTIVATED',
      entityType: 'CatalogService',
      entityId: item.id,
      tenantId,
      actorUserId: actor.userId,
      request,
    });
    return this.serializeService(item);
  }

  async branchCatalog(auth: AuthContext, branchId: string, query: CatalogServiceListDto) {
    await this.requireBranch(auth, branchId);
    return this.listServices(auth, { ...query, branchId });
  }

  async configureBranch(
    tenantId: string,
    branchId: string,
    serviceId: string,
    dto: ConfigureBranchServiceDto,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.requireTenantBranch(tenantId, branchId);
    await this.findService(tenantId, serviceId);
    const previous = await this.prisma.branchService.findUnique({
      where: { branchId_catalogServiceId: { branchId, catalogServiceId: serviceId } },
    });
    const config = await this.prisma.branchService.upsert({
      where: { branchId_catalogServiceId: { branchId, catalogServiceId: serviceId } },
      create: {
        tenantId,
        branchId,
        catalogServiceId: serviceId,
        isAvailable: dto.isAvailable,
        priceOverride:
          dto.priceOverride === null || dto.priceOverride === undefined
            ? null
            : new Prisma.Decimal(dto.priceOverride),
      },
      update: {
        isAvailable: dto.isAvailable,
        priceOverride:
          dto.priceOverride === null || dto.priceOverride === undefined
            ? null
            : new Prisma.Decimal(dto.priceOverride),
      },
    });
    await this.audit.record({
      action: 'BRANCH_SERVICE_CONFIGURED',
      entityType: 'BranchService',
      entityId: config.id,
      tenantId,
      branchId,
      actorUserId: actor.userId,
      metadata: {
        before: previous
          ? {
              isAvailable: previous.isAvailable,
              priceOverride: previous.priceOverride?.toFixed(2) ?? null,
            }
          : null,
        after: {
          isAvailable: config.isAvailable,
          priceOverride: config.priceOverride?.toFixed(2) ?? null,
        },
      },
      request,
    });
    return this.getService(actor, serviceId, branchId);
  }

  async resetBranch(
    tenantId: string,
    branchId: string,
    serviceId: string,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.requireTenantBranch(tenantId, branchId);
    await this.findService(tenantId, serviceId);
    await this.prisma.branchService.deleteMany({
      where: { tenantId, branchId, catalogServiceId: serviceId },
    });
    await this.audit.record({
      action: 'BRANCH_SERVICE_CONFIGURATION_RESET',
      entityType: 'CatalogService',
      entityId: serviceId,
      tenantId,
      branchId,
      actorUserId: actor.userId,
      request,
    });
    return this.getService(actor, serviceId, branchId);
  }

  async isEffectivelyAvailable(
    tenantId: string,
    branchId: string,
    serviceId: string,
  ): Promise<boolean> {
    const item = await this.prisma.catalogService.findFirst({
      where: { id: serviceId, tenantId, deletedAt: null },
      select: {
        isActive: true,
        category: { select: { isActive: true } },
        branchServices: { where: { branchId }, select: { isAvailable: true } },
      },
    });
    return Boolean(
      item?.isActive && item.category.isActive && (item.branchServices[0]?.isAvailable ?? true),
    );
  }

  private serializeService<
    T extends {
      defaultPrice: Prisma.Decimal;
      category: { isActive: boolean };
      isActive: boolean;
      branchServices: Array<{
        branchId: string;
        priceOverride: Prisma.Decimal | null;
        isAvailable: boolean;
      }>;
    },
  >(item: T, branchId?: string) {
    const safe = Object.fromEntries(
      Object.entries(item).filter(([key]) => key !== 'branchServices'),
    );
    const config = branchId
      ? item.branchServices.find((entry) => entry.branchId === branchId)
      : undefined;
    return {
      ...safe,
      defaultPrice: decimalString(item.defaultPrice),
      ...(branchId
        ? {
            branchId,
            priceOverride: config?.priceOverride ? decimalString(config.priceOverride) : null,
            effectivePrice: config?.priceOverride
              ? decimalString(config.priceOverride)
              : decimalString(item.defaultPrice),
            availabilityOverride: config?.isAvailable ?? null,
            effectiveAvailability:
              item.isActive && item.category.isActive && (config?.isAvailable ?? true),
          }
        : {}),
    };
  }

  private async findService(tenantId: string, serviceId: string) {
    const item = await this.prisma.catalogService.findFirst({
      where: { id: serviceId, tenantId, deletedAt: null },
    });
    if (!item) throw this.notFound('CATALOG_SERVICE_NOT_FOUND', 'Catalog service not found');
    return item;
  }
  private async findCategory(tenantId: string, categoryId: string) {
    const item = await this.prisma.serviceCategory.findFirst({
      where: { id: categoryId, tenantId, deletedAt: null },
      select: categorySelect,
    });
    if (!item) throw this.notFound('SERVICE_CATEGORY_NOT_FOUND', 'Service category not found');
    return item;
  }
  private async requireCategory(tenantId: string, categoryId: string): Promise<void> {
    const item = await this.prisma.serviceCategory.findFirst({
      where: { id: categoryId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!item) throw this.notFound('SERVICE_CATEGORY_NOT_FOUND', 'Service category not found');
  }
  private async requireTenantBranch(tenantId: string, branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw this.notFound('BRANCH_NOT_FOUND', 'Branch not found');
  }
  private async requireBranch(auth: AuthContext, branchId: string): Promise<void> {
    const tenantId = this.tenant(auth);
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    const permitted =
      auth.tenantRole === TenantRole.SALON_OWNER || auth.accessibleBranchIds.includes(branchId);
    if (!branch || !permitted) throw this.notFound('BRANCH_NOT_FOUND', 'Branch not found');
  }
  private tenant(auth: AuthContext): string {
    if (!auth.tenantId) throw this.notFound('TENANT_CONTEXT_NOT_FOUND', 'Tenant context not found');
    return auth.tenantId;
  }
  private handleServiceUnique(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const rawTarget = error.meta?.target;
      const target = Array.isArray(rawTarget)
        ? rawTarget.join(',')
        : typeof rawTarget === 'string'
          ? rawTarget
          : '';
      throw new ConflictException({
        code: target.includes('code')
          ? 'CATALOG_SERVICE_CODE_EXISTS'
          : 'CATALOG_SERVICE_NAME_EXISTS',
        message: target.includes('code')
          ? 'Catalog service code already exists'
          : 'Catalog service name already exists in this category',
      });
    }
    throw error;
  }
  private handleUnique(error: unknown, code: string, message: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new ConflictException({ code, message });
    throw error;
  }
  private notFound(code: string, message: string): NotFoundException {
    return new NotFoundException({ code, message });
  }
}
