import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipStatus, Prisma, TenantRole, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import { pageMeta, PaginationDto } from '../common/dto/pagination.dto';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMembershipDto } from './dto/membership.dto';

const memberSelect = {
  id: true,
  tenantId: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true,
      lastLoginAt: true,
    },
  },
  branchAssignments: {
    select: {
      createdAt: true,
      branch: { select: { id: true, name: true, code: true, isActive: true } },
    },
  },
} satisfies Prisma.TenantMembershipSelect;

@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, query: PaginationDto) {
    const where: Prisma.TenantMembershipWhereInput = { tenantId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.tenantMembership.findMany({
        where,
        select: memberSelect,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.tenantMembership.count({ where }),
    ]);
    return { items, meta: pageMeta(total, query.page, query.pageSize) };
  }

  async get(tenantId: string, membershipId: string) {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { id: membershipId, tenantId },
      select: memberSelect,
    });
    if (!membership) throw new NotFoundException('Membership not found');
    return membership;
  }

  async create(
    tenantId: string,
    dto: CreateMembershipDto,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    const branches = dto.branchIds.length
      ? await this.prisma.branch.findMany({
          where: { id: { in: dto.branchIds }, tenantId, deletedAt: null },
          select: { id: true },
        })
      : [];
    if (branches.length !== new Set(dto.branchIds).size)
      throw new NotFoundException('One or more branches were not found');
    const email = dto.email.trim().toLowerCase();
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        let user = await tx.user.findUnique({ where: { email }, select: { id: true } });
        let userCreated = false;
        if (!user) {
          if (!dto.password)
            throw new BadRequestException('Password is required when creating a new user');
          user = await tx.user.create({
            data: {
              email,
              firstName: dto.firstName,
              lastName: dto.lastName,
              passwordHash: await bcrypt.hash(dto.password, 12),
              status: UserStatus.ACTIVE,
            },
            select: { id: true },
          });
          userCreated = true;
        }
        const membership = await tx.tenantMembership.create({
          data: {
            tenantId,
            userId: user.id,
            role: dto.role,
            status: MembershipStatus.ACTIVE,
            branchAssignments: {
              create: branches.map((branch) => ({ branchId: branch.id, tenantId })),
            },
          },
          select: memberSelect,
        });
        await this.audit.record(
          {
            action: 'MEMBERSHIP_CREATED',
            entityType: 'TenantMembership',
            entityId: membership.id,
            tenantId,
            actorUserId: actor.userId,
            metadata: {
              role: dto.role,
              userCreated,
              branchIds: branches.map((branch) => branch.id),
            },
            request,
          },
          tx,
        );
        return membership;
      });
      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('User already has a membership in this tenant');
      }
      throw error;
    }
  }

  async updateRole(
    tenantId: string,
    membershipId: string,
    role: TenantRole,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    const current = await this.get(tenantId, membershipId);
    if (current.role === TenantRole.SALON_OWNER && role !== TenantRole.SALON_OWNER)
      await this.ensureAnotherOwner(tenantId, membershipId);
    const updated = await this.prisma.tenantMembership.update({
      where: { id: membershipId },
      data: { role },
      select: memberSelect,
    });
    await this.audit.record({
      action: 'MEMBERSHIP_ROLE_UPDATED',
      entityType: 'TenantMembership',
      entityId: membershipId,
      tenantId,
      actorUserId: actor.userId,
      metadata: { previousRole: current.role, role },
      request,
    });
    return updated;
  }

  async setStatus(
    tenantId: string,
    membershipId: string,
    status: MembershipStatus,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    const current = await this.get(tenantId, membershipId);
    if (current.role === TenantRole.SALON_OWNER && status !== MembershipStatus.ACTIVE)
      await this.ensureAnotherOwner(tenantId, membershipId);
    const updated = await this.prisma.tenantMembership.update({
      where: { id: membershipId },
      data: { status },
      select: memberSelect,
    });
    if (status !== MembershipStatus.ACTIVE) {
      await this.prisma.refreshSession.updateMany({
        where: { userId: current.user.id, tenantId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.audit.record({
      action:
        status === MembershipStatus.ACTIVE ? 'MEMBERSHIP_REACTIVATED' : 'MEMBERSHIP_SUSPENDED',
      entityType: 'TenantMembership',
      entityId: membershipId,
      tenantId,
      actorUserId: actor.userId,
      request,
    });
    return updated;
  }

  async assignBranch(
    tenantId: string,
    membershipId: string,
    branchId: string,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.get(tenantId, membershipId);
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    await this.prisma.membershipBranch.upsert({
      where: { membershipId_branchId: { membershipId, branchId } },
      create: { membershipId, branchId, tenantId },
      update: {},
    });
    await this.audit.record({
      action: 'BRANCH_ACCESS_ASSIGNED',
      entityType: 'TenantMembership',
      entityId: membershipId,
      tenantId,
      branchId,
      actorUserId: actor.userId,
      request,
    });
    return this.get(tenantId, membershipId);
  }

  async removeBranch(
    tenantId: string,
    membershipId: string,
    branchId: string,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.get(tenantId, membershipId);
    const result = await this.prisma.membershipBranch.deleteMany({
      where: { membershipId, branchId, tenantId },
    });
    if (!result.count) throw new NotFoundException('Branch assignment not found');
    await this.audit.record({
      action: 'BRANCH_ACCESS_REMOVED',
      entityType: 'TenantMembership',
      entityId: membershipId,
      tenantId,
      branchId,
      actorUserId: actor.userId,
      request,
    });
    return this.get(tenantId, membershipId);
  }

  private async ensureAnotherOwner(tenantId: string, excludingId: string): Promise<void> {
    const count = await this.prisma.tenantMembership.count({
      where: {
        tenantId,
        id: { not: excludingId },
        role: TenantRole.SALON_OWNER,
        status: MembershipStatus.ACTIVE,
      },
    });
    if (!count)
      throw new BadRequestException('A tenant must retain at least one active Salon Owner');
  }
}
