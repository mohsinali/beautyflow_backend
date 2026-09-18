import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipStatus, Prisma, TenantRole, TenantStatus, UserStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { cleanText, escapeLikeSearch, normalizeName } from '../common/catalog-values';
import { pageMeta } from '../common/dto/pagination.dto';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { ServiceCatalogService } from '../service-catalog/service-catalog.service';
import {
  CreateServiceProviderDto,
  ServiceProviderListDto,
  UpdateServiceProviderDto,
} from './dto/service-provider.dto';

const providerSelect = {
  id: true,
  membershipId: true,
  displayName: true,
  phone: true,
  jobTitle: true,
  bio: true,
  profileImageUrl: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  membership: {
    select: {
      id: true,
      status: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } },
      branchAssignments: {
        select: { branch: { select: { id: true, name: true, code: true, isActive: true } } },
      },
    },
  },
  qualifications: {
    select: {
      catalogService: {
        select: {
          id: true,
          name: true,
          code: true,
          isActive: true,
          category: { select: { isActive: true } },
        },
      },
    },
  },
} satisfies Prisma.ServiceProviderProfileSelect;

@Injectable()
export class ServiceProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly catalog: ServiceCatalogService,
  ) {}

  async create(
    tenantId: string,
    dto: CreateServiceProviderDto,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { id: dto.membershipId, tenantId },
      select: { role: true },
    });
    if (!membership) throw this.notFound('MEMBERSHIP_NOT_FOUND', 'Membership not found');
    if (membership.role !== TenantRole.SERVICE_PROVIDER)
      throw new ConflictException({
        code: 'MEMBERSHIP_NOT_SERVICE_PROVIDER',
        message: 'Membership must have the Service Provider role',
      });
    try {
      const item = await this.prisma.serviceProviderProfile.create({
        data: {
          ...dto,
          tenantId,
          displayName: cleanText(dto.displayName),
          normalizedName: normalizeName(dto.displayName),
        },
        select: providerSelect,
      });
      await this.audit.record({
        action: 'SERVICE_PROVIDER_CREATED',
        entityType: 'ServiceProviderProfile',
        entityId: item.id,
        tenantId,
        actorUserId: actor.userId,
        request,
      });
      return this.serialize(item);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({
          code: 'SERVICE_PROVIDER_MEMBERSHIP_EXISTS',
          message: 'Membership already has a provider profile',
        });
      throw error;
    }
  }

  async list(auth: AuthContext, query: ServiceProviderListDto) {
    const tenantId = this.tenant(auth);
    if (query.branchId) await this.requireBranchAccess(auth, query.branchId);
    const permittedBranches =
      auth.tenantRole === TenantRole.SALON_OWNER ? undefined : auth.accessibleBranchIds;
    const branchIds = query.branchId ? [query.branchId] : permittedBranches;
    const isActive = auth.tenantRole === TenantRole.SALON_OWNER ? (query.isActive ?? true) : true;
    const search = query.search ? escapeLikeSearch(query.search) : undefined;
    const where: Prisma.ServiceProviderProfileWhereInput = {
      tenantId,
      deletedAt: null,
      isActive,
      ...(isActive === false && !branchIds
        ? {}
        : {
            membership: {
              ...(isActive === false
                ? {}
                : { status: MembershipStatus.ACTIVE, user: { status: UserStatus.ACTIVE } }),
              ...(branchIds
                ? {
                    branchAssignments: {
                      some: { branchId: { in: branchIds }, branch: { isActive: true } },
                    },
                  }
                : {}),
            },
          }),
      ...(auth.tenantRole === TenantRole.SERVICE_PROVIDER
        ? { membershipId: auth.membershipId ?? '00000000-0000-0000-0000-000000000000' }
        : {}),
      ...(query.catalogServiceId
        ? { qualifications: { some: { catalogServiceId: query.catalogServiceId } } }
        : {}),
      ...(search
        ? {
            OR: [
              { displayName: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
              {
                membership: {
                  user: {
                    OR: [
                      { firstName: { contains: search, mode: 'insensitive' } },
                      { lastName: { contains: search, mode: 'insensitive' } },
                      { email: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.serviceProviderProfile.findMany({
        where,
        select: providerSelect,
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.serviceProviderProfile.count({ where }),
    ]);
    return {
      items: items.map((item) => this.serialize(item)),
      meta: pageMeta(total, query.page, query.pageSize),
    };
  }

  async get(auth: AuthContext, providerId: string) {
    const item = await this.find(this.tenant(auth), providerId);
    this.assertReadable(auth, item);
    return this.serialize(item);
  }

  async update(
    tenantId: string,
    providerId: string,
    dto: UpdateServiceProviderDto,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.find(tenantId, providerId);
    const item = await this.prisma.serviceProviderProfile.update({
      where: { id: providerId },
      data: {
        ...dto,
        ...(dto.displayName === undefined
          ? {}
          : {
              displayName: cleanText(dto.displayName),
              normalizedName: normalizeName(dto.displayName),
            }),
      },
      select: providerSelect,
    });
    await this.audit.record({
      action: 'SERVICE_PROVIDER_UPDATED',
      entityType: 'ServiceProviderProfile',
      entityId: providerId,
      tenantId,
      actorUserId: actor.userId,
      metadata: { changedFields: Object.keys(dto) },
      request,
    });
    return this.serialize(item);
  }

  async setActive(
    tenantId: string,
    providerId: string,
    isActive: boolean,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.find(tenantId, providerId);
    const item = await this.prisma.serviceProviderProfile.update({
      where: { id: providerId },
      data: { isActive },
      select: providerSelect,
    });
    await this.audit.record({
      action: isActive ? 'SERVICE_PROVIDER_REACTIVATED' : 'SERVICE_PROVIDER_DEACTIVATED',
      entityType: 'ServiceProviderProfile',
      entityId: providerId,
      tenantId,
      actorUserId: actor.userId,
      request,
    });
    return this.serialize(item);
  }

  async qualifications(auth: AuthContext, providerId: string) {
    const item = await this.find(this.tenant(auth), providerId);
    this.assertReadable(auth, item);
    return item.qualifications.map((qualification) => qualification.catalogService);
  }

  async addQualification(
    tenantId: string,
    providerId: string,
    serviceId: string,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.find(tenantId, providerId);
    await this.requireActiveServices(tenantId, [serviceId]);
    await this.prisma.providerService.upsert({
      where: {
        providerProfileId_catalogServiceId: {
          providerProfileId: providerId,
          catalogServiceId: serviceId,
        },
      },
      create: { tenantId, providerProfileId: providerId, catalogServiceId: serviceId },
      update: {},
    });
    await this.audit.record({
      action: 'PROVIDER_QUALIFICATION_ADDED',
      entityType: 'ServiceProviderProfile',
      entityId: providerId,
      tenantId,
      actorUserId: actor.userId,
      metadata: { serviceId },
      request,
    });
    return this.qualifications(actor, providerId);
  }

  async removeQualification(
    tenantId: string,
    providerId: string,
    serviceId: string,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.find(tenantId, providerId);
    await this.prisma.providerService.deleteMany({
      where: { tenantId, providerProfileId: providerId, catalogServiceId: serviceId },
    });
    await this.audit.record({
      action: 'PROVIDER_QUALIFICATION_REMOVED',
      entityType: 'ServiceProviderProfile',
      entityId: providerId,
      tenantId,
      actorUserId: actor.userId,
      metadata: { serviceId },
      request,
    });
    return this.qualifications(actor, providerId);
  }

  async replaceQualifications(
    tenantId: string,
    providerId: string,
    rawIds: string[],
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.find(tenantId, providerId);
    const serviceIds = [...new Set(rawIds)];
    await this.requireActiveServices(tenantId, serviceIds);
    await this.prisma.$transaction(async (tx) => {
      await tx.providerService.deleteMany({ where: { tenantId, providerProfileId: providerId } });
      if (serviceIds.length)
        await tx.providerService.createMany({
          data: serviceIds.map((catalogServiceId) => ({
            tenantId,
            providerProfileId: providerId,
            catalogServiceId,
          })),
        });
      await this.audit.record(
        {
          action: 'PROVIDER_QUALIFICATIONS_REPLACED',
          entityType: 'ServiceProviderProfile',
          entityId: providerId,
          tenantId,
          actorUserId: actor.userId,
          metadata: { serviceIds },
          request,
        },
        tx,
      );
    });
    return this.qualifications(actor, providerId);
  }

  async eligible(auth: AuthContext, branchId: string, serviceId: string) {
    const tenantId = this.tenant(auth);
    if (auth.tenantRole === TenantRole.SERVICE_PROVIDER)
      throw new ForbiddenException('Insufficient permission');
    await this.requireBranchAccess(auth, branchId);
    if (!(await this.catalog.isEffectivelyAvailable(tenantId, branchId, serviceId))) return [];
    const items = await this.prisma.serviceProviderProfile.findMany({
      where: {
        tenantId,
        isActive: true,
        deletedAt: null,
        membership: {
          status: MembershipStatus.ACTIVE,
          user: { status: UserStatus.ACTIVE, deletedAt: null },
          tenant: { status: TenantStatus.ACTIVE, deletedAt: null },
          branchAssignments: { some: { branchId, branch: { isActive: true, deletedAt: null } } },
        },
        qualifications: {
          some: {
            catalogServiceId: serviceId,
            catalogService: {
              isActive: true,
              deletedAt: null,
              category: { isActive: true, deletedAt: null },
            },
          },
        },
      },
      select: providerSelect,
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    });
    return items.map((item) => this.serialize(item));
  }

  private serialize<
    T extends {
      membership: {
        status: MembershipStatus;
        user: { status: UserStatus };
        branchAssignments: Array<{ branch: unknown }>;
      };
      qualifications: Array<{ catalogService: unknown }>;
      isActive: boolean;
    },
  >(item: T) {
    const { membership, qualifications, ...profile } = item;
    const { branchAssignments, user, ...safeMembership } = membership;
    return {
      ...profile,
      membership: safeMembership,
      user,
      assignedBranches: branchAssignments.map((entry) => entry.branch),
      qualifications: qualifications.map((entry) => entry.catalogService),
      qualifiedServiceCount: qualifications.length,
      effectivelyActive:
        item.isActive &&
        membership.status === MembershipStatus.ACTIVE &&
        membership.user.status === UserStatus.ACTIVE,
    };
  }

  private async find(tenantId: string, providerId: string) {
    const item = await this.prisma.serviceProviderProfile.findFirst({
      where: { id: providerId, tenantId, deletedAt: null },
      select: providerSelect,
    });
    if (!item) throw this.notFound('SERVICE_PROVIDER_NOT_FOUND', 'Service provider not found');
    return item;
  }
  private async requireActiveServices(tenantId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const count = await this.prisma.catalogService.count({
      where: {
        id: { in: ids },
        tenantId,
        isActive: true,
        deletedAt: null,
        category: { isActive: true, deletedAt: null },
      },
    });
    if (count !== ids.length)
      throw this.notFound(
        'CATALOG_SERVICE_NOT_FOUND',
        'One or more active catalog services were not found',
      );
  }
  private assertReadable(
    auth: AuthContext,
    item: {
      membershipId: string;
      isActive: boolean;
      membership: {
        status: MembershipStatus;
        user: { status: UserStatus };
        branchAssignments: Array<{ branch: { id: string; isActive: boolean } }>;
      };
    },
  ): void {
    if (auth.tenantRole === TenantRole.SALON_OWNER) return;
    const own = item.membershipId === auth.membershipId;
    const assigned = item.membership.branchAssignments.some(
      ({ branch }) => branch.isActive && auth.accessibleBranchIds.includes(branch.id),
    );
    const active =
      item.isActive &&
      item.membership.status === MembershipStatus.ACTIVE &&
      item.membership.user.status === UserStatus.ACTIVE;
    if (
      (auth.tenantRole === TenantRole.SERVICE_PROVIDER && !own) ||
      (auth.tenantRole === TenantRole.RECEPTIONIST && (!assigned || !active))
    )
      throw this.notFound('SERVICE_PROVIDER_NOT_FOUND', 'Service provider not found');
  }
  private async requireBranchAccess(auth: AuthContext, branchId: string): Promise<void> {
    const tenantId = this.tenant(auth);
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (
      !branch ||
      (auth.tenantRole !== TenantRole.SALON_OWNER && !auth.accessibleBranchIds.includes(branchId))
    )
      throw this.notFound('BRANCH_NOT_FOUND', 'Branch not found');
  }
  private tenant(auth: AuthContext): string {
    if (!auth.tenantId) throw this.notFound('TENANT_CONTEXT_NOT_FOUND', 'Tenant context not found');
    return auth.tenantId;
  }
  private notFound(code: string, message: string): NotFoundException {
    return new NotFoundException({ code, message });
  }
}
