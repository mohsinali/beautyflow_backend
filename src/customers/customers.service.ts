import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { cleanText, normalizeName } from '../common/catalog-values';
import { pageMeta } from '../common/dto/pagination.dto';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCustomerDto,
  CustomerListDto,
  CustomerStatusFilter,
  UpdateCustomerDto,
} from './dto/customer.dto';

const customerSelect = {
  id: true,
  name: true,
  phone: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  preferredBranch: { select: { id: true, name: true, code: true, isActive: true } },
} satisfies Prisma.CustomerSelect;

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  return digits ? `${trimmed.startsWith('+') ? '+' : ''}${digits}` : null;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    tenantId: string,
    dto: CreateCustomerDto,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.requireBranch(tenantId, dto.preferredBranchId);
    const phone = this.optionalText(dto.phone);
    const normalizedPhone = normalizePhone(phone);
    await this.requireUniquePhone(tenantId, normalizedPhone);
    try {
      const customer = await this.prisma.customer.create({
        data: {
          tenantId,
          name: cleanText(dto.name),
          normalizedName: normalizeName(dto.name),
          phone,
          normalizedPhone,
          notes: this.optionalText(dto.notes),
          preferredBranchId: dto.preferredBranchId ?? null,
        },
        select: customerSelect,
      });
      await this.audit.record({
        action: 'CUSTOMER_CREATED',
        entityType: 'Customer',
        entityId: customer.id,
        tenantId,
        actorUserId: actor.userId,
        request,
      });
      return customer;
    } catch (error) {
      this.handleUnique(error);
    }
  }

  async list(tenantId: string, query: CustomerListDto) {
    const normalizedSearch = query.search ? normalizePhone(query.search) : null;
    const where: Prisma.CustomerWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.status === CustomerStatusFilter.ALL
        ? {}
        : { isActive: query.status === CustomerStatusFilter.ACTIVE }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              ...(normalizedSearch ? [{ normalizedPhone: { contains: normalizedSearch } }] : []),
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        select: customerSelect,
        orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);
    return { items, meta: pageMeta(total, query.page, query.pageSize) };
  }

  async get(tenantId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: customerSelect,
    });
    if (!customer) throw this.notFound();
    return customer;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateCustomerDto,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.requireCustomer(tenantId, id);
    await this.requireBranch(tenantId, dto.preferredBranchId);
    const phoneProvided = Object.prototype.hasOwnProperty.call(dto, 'phone');
    const phone = phoneProvided ? this.optionalText(dto.phone) : undefined;
    const normalizedPhone = phoneProvided ? normalizePhone(phone) : undefined;
    if (phoneProvided) await this.requireUniquePhone(tenantId, normalizedPhone ?? null, id);
    const data: Prisma.CustomerUpdateInput = {
      ...(dto.name === undefined
        ? {}
        : { name: cleanText(dto.name), normalizedName: normalizeName(dto.name) }),
      ...(phoneProvided ? { phone: phone ?? null, normalizedPhone: normalizedPhone ?? null } : {}),
      ...(dto.notes === undefined ? {} : { notes: this.optionalText(dto.notes) }),
      ...(dto.preferredBranchId === undefined
        ? {}
        : {
            preferredBranch: dto.preferredBranchId
              ? { connect: { id_tenantId: { id: dto.preferredBranchId, tenantId } } }
              : { disconnect: true },
          }),
    };
    try {
      const customer = await this.prisma.customer.update({
        where: { id },
        data,
        select: customerSelect,
      });
      await this.audit.record({
        action: 'CUSTOMER_UPDATED',
        entityType: 'Customer',
        entityId: id,
        tenantId,
        actorUserId: actor.userId,
        metadata: { changedFields: Object.keys(dto) },
        request,
      });
      return customer;
    } catch (error) {
      this.handleUnique(error);
    }
  }

  async setActive(
    tenantId: string,
    id: string,
    isActive: boolean,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    const existing = await this.requireCustomer(tenantId, id);
    if (isActive) await this.requireUniquePhone(tenantId, existing.normalizedPhone, id);
    try {
      const customer = await this.prisma.customer.update({
        where: { id },
        data: { isActive },
        select: customerSelect,
      });
      await this.audit.record({
        action: isActive ? 'CUSTOMER_REACTIVATED' : 'CUSTOMER_DEACTIVATED',
        entityType: 'Customer',
        entityId: id,
        tenantId,
        actorUserId: actor.userId,
        request,
      });
      return customer;
    } catch (error) {
      this.handleUnique(error);
    }
  }

  private async requireCustomer(tenantId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, normalizedPhone: true },
    });
    if (!customer) throw this.notFound();
    return customer;
  }

  private async requireBranch(tenantId: string, branchId: string | null | undefined) {
    if (!branchId) return;
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!branch)
      throw new NotFoundException({
        code: 'CUSTOMER_BRANCH_NOT_FOUND',
        message: 'Preferred branch not found',
      });
  }

  private async requireUniquePhone(
    tenantId: string,
    normalizedPhone: string | null,
    excludeId?: string,
  ) {
    if (!normalizedPhone) return;
    const duplicate = await this.prisma.customer.findFirst({
      where: {
        tenantId,
        normalizedPhone,
        isActive: true,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) throw this.phoneExists();
  }

  private optionalText(value: string | null | undefined): string | null {
    return value?.trim() || null;
  }

  private handleUnique(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw this.phoneExists();
    throw error;
  }

  private phoneExists() {
    return new ConflictException({
      code: 'CUSTOMER_PHONE_EXISTS',
      message: 'Phone number already belongs to another active customer',
    });
  }

  private notFound() {
    return new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
  }
}
