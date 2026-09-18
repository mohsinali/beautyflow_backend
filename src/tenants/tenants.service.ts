import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipStatus, Prisma, TenantRole, TenantStatus, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import { pageMeta, PaginationDto } from '../common/dto/pagination.dto';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTenantDto,
  UpdatePlatformTenantDto,
  UpdateTenantSettingsDto,
} from './dto/tenant.dto';

const tenantSelect = {
  id: true,
  name: true,
  slug: true,
  defaultLanguage: true,
  currencyCode: true,
  timezone: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TenantSelect;

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateTenantDto, actor: AuthContext, request: RequestWithContext) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: dto.name,
            slug: dto.slug,
            defaultLanguage: dto.defaultLanguage,
            currencyCode: dto.currencyCode,
            timezone: dto.timezone,
          },
          select: tenantSelect,
        });
        const branch = await tx.branch.create({
          data: {
            tenantId: tenant.id,
            ...dto.initialBranch,
            code: dto.initialBranch.code.toUpperCase(),
          },
          select: { id: true, name: true, code: true },
        });
        const normalizedEmail = dto.owner.email.trim().toLowerCase();
        let user = await tx.user.findUnique({
          where: { email: normalizedEmail },
          select: { id: true },
        });
        if (!user) {
          user = await tx.user.create({
            data: {
              email: normalizedEmail,
              firstName: dto.owner.firstName,
              lastName: dto.owner.lastName,
              passwordHash: await bcrypt.hash(dto.owner.password, 12),
              status: UserStatus.ACTIVE,
            },
            select: { id: true },
          });
        }
        const membership = await tx.tenantMembership.create({
          data: {
            tenantId: tenant.id,
            userId: user.id,
            role: TenantRole.SALON_OWNER,
            status: MembershipStatus.ACTIVE,
          },
          select: { id: true, role: true },
        });
        await this.audit.record(
          {
            action: 'TENANT_CREATED',
            entityType: 'Tenant',
            entityId: tenant.id,
            tenantId: tenant.id,
            actorUserId: actor.userId,
            metadata: { branchId: branch.id, ownerUserId: user.id },
            request,
          },
          tx,
        );
        return {
          tenant,
          initialBranch: branch,
          owner: { userId: user.id, membershipId: membership.id, role: membership.role },
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Tenant slug, owner membership, or branch code already exists');
      }
      throw error;
    }
  }

  async list(query: PaginationDto) {
    const where: Prisma.TenantWhereInput = { deletedAt: null };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({
        where,
        select: tenantSelect,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.tenant.count({ where }),
    ]);
    return { items, meta: pageMeta(total, query.page, query.pageSize) };
  }

  async get(tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: { ...tenantSelect, _count: { select: { branches: true, memberships: true } } },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async platformUpdate(
    tenantId: string,
    dto: UpdatePlatformTenantDto,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.get(tenantId);
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: dto,
      select: tenantSelect,
    });
    await this.audit.record({
      action: 'TENANT_UPDATED',
      entityType: 'Tenant',
      entityId: tenantId,
      tenantId,
      actorUserId: actor.userId,
      metadata: { changedFields: Object.keys(dto) },
      request,
    });
    return tenant;
  }

  async setStatus(
    tenantId: string,
    status: TenantStatus,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.get(tenantId);
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status },
      select: tenantSelect,
    });
    await this.audit.record({
      action: status === TenantStatus.SUSPENDED ? 'TENANT_SUSPENDED' : 'TENANT_REACTIVATED',
      entityType: 'Tenant',
      entityId: tenantId,
      tenantId,
      actorUserId: actor.userId,
      request,
    });
    return tenant;
  }

  async settings(tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: tenantSelect,
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async updateSettings(
    tenantId: string,
    dto: UpdateTenantSettingsDto,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: dto,
      select: tenantSelect,
    });
    await this.audit.record({
      action: 'TENANT_SETTINGS_UPDATED',
      entityType: 'Tenant',
      entityId: tenantId,
      tenantId,
      actorUserId: actor.userId,
      metadata: { changedFields: Object.keys(dto) },
      request,
    });
    return tenant;
  }
}
