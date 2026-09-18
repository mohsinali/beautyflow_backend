import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TenantRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { pageMeta, PaginationDto } from '../common/dto/pagination.dto';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

const select = {
  id: true,
  name: true,
  code: true,
  phone: true,
  email: true,
  address: true,
  city: true,
  timezone: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  tenant: { select: { timezone: true } },
} satisfies Prisma.BranchSelect;

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    tenantId: string,
    dto: CreateBranchDto,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    try {
      const branch = await this.prisma.branch.create({
        data: { tenantId, ...dto, code: dto.code.toUpperCase() },
        select,
      });
      await this.audit.record({
        action: 'BRANCH_CREATED',
        entityType: 'Branch',
        entityId: branch.id,
        tenantId,
        branchId: branch.id,
        actorUserId: actor.userId,
        request,
      });
      return this.serialize(branch);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Branch code already exists in this tenant');
      }
      throw error;
    }
  }

  async list(auth: AuthContext, query: PaginationDto) {
    const tenantId = this.requireTenant(auth);
    const where: Prisma.BranchWhereInput = {
      tenantId,
      deletedAt: null,
      ...(auth.tenantRole === TenantRole.SALON_OWNER
        ? {}
        : { id: { in: auth.accessibleBranchIds } }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.branch.findMany({
        where,
        select,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.branch.count({ where }),
    ]);
    return {
      items: items.map((branch) => this.serialize(branch)),
      meta: pageMeta(total, query.page, query.pageSize),
    };
  }

  async get(auth: AuthContext, branchId: string) {
    const tenantId = this.requireTenant(auth);
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        tenantId,
        deletedAt: null,
        ...(auth.tenantRole === TenantRole.SALON_OWNER
          ? {}
          : { id: { in: auth.accessibleBranchIds } }),
      },
      select,
    });
    if (!branch) throw new NotFoundException('Branch not found');
    return this.serialize(branch);
  }

  async update(
    tenantId: string,
    branchId: string,
    dto: UpdateBranchDto,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.ownerScoped(tenantId, branchId);
    try {
      const branch = await this.prisma.branch.update({
        where: { id: branchId },
        data: { ...dto, ...(dto.code ? { code: dto.code.toUpperCase() } : {}) },
        select,
      });
      await this.audit.record({
        action: 'BRANCH_UPDATED',
        entityType: 'Branch',
        entityId: branchId,
        tenantId,
        branchId,
        actorUserId: actor.userId,
        metadata: { changedFields: Object.keys(dto) },
        request,
      });
      return this.serialize(branch);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Branch code already exists in this tenant');
      }
      throw error;
    }
  }

  async setActive(
    tenantId: string,
    branchId: string,
    isActive: boolean,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.ownerScoped(tenantId, branchId);
    const branch = await this.prisma.branch.update({
      where: { id: branchId },
      data: { isActive },
      select,
    });
    await this.audit.record({
      action: isActive ? 'BRANCH_REACTIVATED' : 'BRANCH_DEACTIVATED',
      entityType: 'Branch',
      entityId: branchId,
      tenantId,
      branchId,
      actorUserId: actor.userId,
      request,
    });
    return this.serialize(branch);
  }

  private async ownerScoped(tenantId: string, branchId: string): Promise<void> {
    const exists = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Branch not found');
  }

  private requireTenant(auth: AuthContext): string {
    if (!auth.tenantId) throw new NotFoundException('Tenant context not found');
    return auth.tenantId;
  }

  private serialize<T extends { tenant: { timezone: string }; timezone: string | null }>(
    branch: T,
  ) {
    const { tenant, ...safe } = branch;
    return { ...safe, timezone: branch.timezone ?? tenant.timezone };
  }
}
