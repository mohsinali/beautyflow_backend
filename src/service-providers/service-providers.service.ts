import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvitationPurpose,
  MembershipStatus,
  Prisma,
  TenantRole,
  TenantStatus,
  UserStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { cleanText, escapeLikeSearch, normalizeName } from '../common/catalog-values';
import { pageMeta } from '../common/dto/pagination.dto';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService } from '../invitations/invitations.service';
import { ServiceCatalogService } from '../service-catalog/service-catalog.service';
import {
  CreateServiceProviderDto,
  OnboardServiceProviderDto,
  ServiceProviderInvitationListDto,
  ServiceProviderListDto,
  UpdateServiceProviderInvitationEmailDto,
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
  photoStorageKey: true,
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
      invitations: {
        orderBy: { createdAt: 'desc' as const },
        take: 1,
        select: { deliveryStatus: true, expiresAt: true, usedAt: true, revokedAt: true },
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
          category: { select: { id: true, name: true, isActive: true } },
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
    private readonly invitations: InvitationsService,
  ) {}

  async onboard(
    tenantId: string,
    dto: OnboardServiceProviderDto,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    const email = dto.email.trim().toLowerCase();
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        let user = await tx.user.findUnique({ where: { email } });
        let userCreated = false;
        if (
          user &&
          (user.deletedAt ||
            (user.status !== UserStatus.ACTIVE && user.status !== UserStatus.INVITED))
        )
          throw new ConflictException({
            code: 'USER_REQUIRES_ATTENTION',
            message: 'The existing account requires administrative attention',
          });
        if (!user) {
          user = await tx.user.create({
            data: {
              email,
              firstName: cleanText(dto.displayName),
              lastName: '',
              passwordHash: null,
              status: UserStatus.INVITED,
            },
          });
          userCreated = true;
          await this.audit.record(
            {
              action: 'USER_INVITED_CREATED',
              entityType: 'User',
              entityId: user.id,
              tenantId,
              actorUserId: actor.userId,
              request,
            },
            tx,
          );
        }
        let membership = await tx.tenantMembership.findUnique({
          where: { tenantId_userId: { tenantId, userId: user.id } },
          include: { providerProfile: { select: { id: true } } },
        });
        let membershipCreated = false;
        if (membership) {
          if (membership.role !== TenantRole.SERVICE_PROVIDER)
            throw new ConflictException({
              code: 'MEMBERSHIP_ROLE_CONFLICT',
              message: 'This person already has a different role in this salon',
            });
          if (membership.status !== MembershipStatus.ACTIVE)
            throw new ConflictException({
              code: 'MEMBERSHIP_REQUIRES_ATTENTION',
              message: 'The existing membership requires administrative attention',
            });
          if (membership.providerProfile)
            throw new ConflictException({
              code: 'SERVICE_PROVIDER_EXISTS',
              message: 'A provider profile already exists',
              providerId: membership.providerProfile.id,
            });
        } else {
          membership = await tx.tenantMembership.create({
            data: {
              tenantId,
              userId: user.id,
              role: TenantRole.SERVICE_PROVIDER,
              status: MembershipStatus.ACTIVE,
            },
            include: { providerProfile: { select: { id: true } } },
          });
          membershipCreated = true;
          await this.audit.record(
            {
              action: 'MEMBERSHIP_CREATED',
              entityType: 'TenantMembership',
              entityId: membership.id,
              tenantId,
              actorUserId: actor.userId,
              metadata: { role: TenantRole.SERVICE_PROVIDER, userCreated, branchIds: [] },
              request,
            },
            tx,
          );
        }
        const provider = await tx.serviceProviderProfile.create({
          data: {
            tenantId,
            membershipId: membership.id,
            displayName: cleanText(dto.displayName),
            normalizedName: normalizeName(dto.displayName),
            phone: dto.phone || null,
            jobTitle: dto.jobTitle || null,
            bio: dto.bio || null,
            isActive: dto.isActive,
          },
          select: providerSelect,
        });
        const invitation = await this.invitations.issue(tx, {
          userId: user.id,
          tenantId,
          membershipId: membership.id,
          purpose: user.passwordHash
            ? InvitationPurpose.TENANT_PROVIDER_INVITE
            : InvitationPurpose.PASSWORD_SETUP,
          createdById: actor.userId,
          request,
        });
        await this.audit.record(
          {
            action: 'SERVICE_PROVIDER_ONBOARDED',
            entityType: 'ServiceProviderProfile',
            entityId: provider.id,
            tenantId,
            actorUserId: actor.userId,
            metadata: { userCreated, membershipCreated },
            request,
          },
          tx,
        );
        return { provider, invitation, requiresPassword: !user.passwordHash };
      });
      const invitationStatus = await this.invitations.deliver(result.invitation);
      return {
        provider: this.serialize(result.provider),
        accountState: result.requiresPassword ? 'INVITATION_REQUIRED' : 'ACCOUNT_ACTIVE',
        invitationStatus,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({
          code: 'SERVICE_PROVIDER_CONFLICT',
          message: 'This provider could not be created because a related record already exists',
        });
      throw error;
    }
  }

  async resendInvitation(
    tenantId: string,
    providerId: string,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    const issued = await this.prisma.$transaction(async (tx) => {
      const provider = await tx.serviceProviderProfile.findFirst({
        where: { id: providerId, tenantId, deletedAt: null },
        select: {
          membership: {
            select: { id: true, user: { select: { id: true, passwordHash: true, status: true } } },
          },
        },
      });
      if (!provider)
        throw this.notFound('SERVICE_PROVIDER_NOT_FOUND', 'Service provider not found');
      if (
        provider.membership.user.passwordHash &&
        provider.membership.user.status === UserStatus.ACTIVE
      )
        throw new ConflictException({
          code: 'INVITATION_NOT_REQUIRED',
          message: 'This account is already active',
        });
      return this.invitations.issue(tx, {
        userId: provider.membership.user.id,
        tenantId,
        membershipId: provider.membership.id,
        purpose: provider.membership.user.passwordHash
          ? InvitationPurpose.TENANT_PROVIDER_INVITE
          : InvitationPurpose.PASSWORD_SETUP,
        createdById: actor.userId,
        request,
        auditAction: 'PROVIDER_INVITATION_RESENT',
      });
    });
    return { invitationStatus: await this.invitations.deliver(issued) };
  }

  async listInvitations(tenantId: string, query: ServiceProviderInvitationListDto) {
    const now = new Date();
    const statusWhere: Prisma.AccountInvitationWhereInput =
      query.status === 'ACCEPTED'
        ? { usedAt: { not: null } }
        : query.status === 'CANCELLED'
          ? { revokedAt: { not: null }, usedAt: null }
          : query.status === 'EXPIRED'
            ? { expiresAt: { lte: now }, usedAt: null, revokedAt: null }
            : query.status === 'PENDING'
              ? { expiresAt: { gt: now }, usedAt: null, revokedAt: null }
              : {};
    const where: Prisma.AccountInvitationWhereInput = {
      tenantId,
      membership: { role: TenantRole.SERVICE_PROVIDER, providerProfile: { isNot: null } },
      ...statusWhere,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.accountInvitation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          usedAt: true,
          revokedAt: true,
          deliveryStatus: true,
          user: { select: { email: true } },
          membership: { select: { providerProfile: { select: { displayName: true } } } },
        },
      }),
      this.prisma.accountInvitation.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        name: item.membership.providerProfile?.displayName ?? '',
        email: item.user.email,
        status: item.usedAt
          ? 'ACCEPTED'
          : item.revokedAt
            ? 'CANCELLED'
            : item.expiresAt <= now
              ? 'EXPIRED'
              : 'PENDING',
        deliveryStatus: item.deliveryStatus,
        invitedAt: item.createdAt,
        expiresAt: item.expiresAt,
      })),
      meta: pageMeta(total, query.page, query.pageSize),
    };
  }

  async resendManagedInvitation(
    tenantId: string,
    invitationId: string,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    const issued = await this.prisma.$transaction(async (tx) => {
      const invitation = await this.managedInvitation(tx, tenantId, invitationId);
      this.assertInvitationActionable(invitation);
      return this.invitations.issue(tx, {
        userId: invitation.userId,
        tenantId,
        membershipId: invitation.membershipId,
        purpose: invitation.user.passwordHash
          ? InvitationPurpose.TENANT_PROVIDER_INVITE
          : InvitationPurpose.PASSWORD_SETUP,
        createdById: actor.userId,
        request,
        auditAction: 'PROVIDER_INVITATION_RESENT',
      });
    });
    return { invitationStatus: await this.invitations.deliver(issued) };
  }

  async updateInvitationEmail(
    tenantId: string,
    invitationId: string,
    dto: UpdateServiceProviderInvitationEmailDto,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    const email = dto.email.toLowerCase();
    const issued = await this.prisma.$transaction(async (tx) => {
      const invitation = await this.managedInvitation(tx, tenantId, invitationId);
      this.assertInvitationActionable(invitation);
      if (invitation.user.email === email)
        throw new ConflictException({
          code: 'INVITATION_EMAIL_UNCHANGED',
          message: 'The new email must be different',
        });
      let target = await tx.user.findUnique({ where: { email } });
      if (
        target?.deletedAt ||
        (target && target.status !== UserStatus.ACTIVE && target.status !== UserStatus.INVITED)
      )
        throw new ConflictException({
          code: 'USER_REQUIRES_ATTENTION',
          message: 'The existing account requires administrative attention',
        });
      if (target) {
        const conflict = await tx.tenantMembership.findUnique({
          where: { tenantId_userId: { tenantId, userId: target.id } },
        });
        if (conflict)
          throw new ConflictException({
            code: 'INVITATION_EMAIL_EXISTS',
            message: 'This email already belongs to a member of this salon',
          });
      } else {
        const profile = invitation.membership.providerProfile;
        const [firstName = profile!.displayName, ...rest] = profile!.displayName
          .trim()
          .split(/\s+/);
        target = await tx.user.create({
          data: {
            email,
            firstName,
            lastName: rest.join(' '),
            status: UserStatus.INVITED,
          },
        });
      }
      await tx.accountInvitation.updateMany({
        where: { membershipId: invitation.membershipId, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date(), activeKey: null },
      });
      await tx.tenantMembership.update({
        where: { id: invitation.membershipId },
        data: { userId: target.id },
      });
      return this.invitations.issue(tx, {
        userId: target.id,
        tenantId,
        membershipId: invitation.membershipId,
        purpose: target.passwordHash
          ? InvitationPurpose.TENANT_PROVIDER_INVITE
          : InvitationPurpose.PASSWORD_SETUP,
        createdById: actor.userId,
        request,
        auditAction: 'PROVIDER_INVITATION_EMAIL_UPDATED',
      });
    });
    return { invitationStatus: await this.invitations.deliver(issued) };
  }

  async cancelInvitation(
    tenantId: string,
    invitationId: string,
    actor: AuthContext,
    request: RequestWithContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const invitation = await this.managedInvitation(tx, tenantId, invitationId);
      this.assertInvitationActionable(invitation, false);
      const cancelled = await tx.accountInvitation.updateMany({
        where: { id: invitationId, tenantId, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date(), activeKey: null },
      });
      if (cancelled.count !== 1)
        throw new ConflictException({
          code: 'INVITATION_NOT_PENDING',
          message: 'Invitation is not pending',
        });
      await this.audit.record(
        {
          action: 'PROVIDER_INVITATION_CANCELLED',
          entityType: 'AccountInvitation',
          entityId: invitationId,
          tenantId,
          actorUserId: actor.userId,
          metadata: { membershipId: invitation.membershipId },
          request,
        },
        tx,
      );
    });
    return { cancelled: true };
  }

  private managedInvitation(tx: Prisma.TransactionClient, tenantId: string, invitationId: string) {
    return tx.accountInvitation
      .findFirst({
        where: { id: invitationId, tenantId, membership: { role: TenantRole.SERVICE_PROVIDER } },
        include: { user: true, membership: { include: { providerProfile: true } } },
      })
      .then((invitation) => {
        if (!invitation?.membership.providerProfile)
          throw this.notFound('INVITATION_NOT_FOUND', 'Invitation not found');
        return invitation;
      });
  }

  private assertInvitationActionable(
    invitation: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
    allowExpired = true,
  ) {
    if (invitation.usedAt)
      throw new ConflictException({
        code: 'INVITATION_ALREADY_ACCEPTED',
        message: 'Invitation has already been accepted',
      });
    if (invitation.revokedAt)
      throw new ConflictException({
        code: 'INVITATION_NOT_PENDING',
        message: 'Invitation is not pending',
      });
    if (!allowExpired && invitation.expiresAt <= new Date())
      throw new ConflictException({
        code: 'INVITATION_EXPIRED',
        message: 'Invitation has expired',
      });
  }

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

  async availableMemberships(tenantId: string) {
    return this.prisma.tenantMembership.findMany({
      where: {
        tenantId,
        role: TenantRole.SERVICE_PROVIDER,
        status: MembershipStatus.ACTIVE,
        user: { status: UserStatus.ACTIVE, deletedAt: null },
        providerProfile: null,
      },
      select: {
        id: true,
        user: { select: { email: true, firstName: true, lastName: true } },
        branchAssignments: {
          select: { branch: { select: { id: true, name: true, code: true, isActive: true } } },
        },
      },
      orderBy: [{ user: { firstName: 'asc' } }, { id: 'asc' }],
    });
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

  async isEligible(
    tenantId: string,
    branchId: string,
    serviceId: string,
    providerId: string,
  ): Promise<boolean> {
    if (!(await this.catalog.isEffectivelyAvailable(tenantId, branchId, serviceId))) return false;
    const provider = await this.prisma.serviceProviderProfile.findFirst({
      where: {
        id: providerId,
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
      select: { id: true },
    });
    return Boolean(provider);
  }

  private serialize<
    T extends {
      id: string;
      profileImageUrl: string | null;
      photoStorageKey: string | null;
      updatedAt: Date;
      membership: {
        status: MembershipStatus;
        user: { status: UserStatus };
        branchAssignments: Array<{ branch: unknown }>;
        invitations: Array<{
          deliveryStatus: string;
          expiresAt: Date;
          usedAt: Date | null;
          revokedAt: Date | null;
        }>;
      };
      qualifications: Array<{ catalogService: unknown }>;
      isActive: boolean;
    },
  >(item: T) {
    const { membership, qualifications, photoStorageKey, ...profile } = item;
    const { branchAssignments, user, invitations, ...safeMembership } = membership;
    const invitation = invitations?.[0];
    const accountStatus =
      user.status === UserStatus.ACTIVE
        ? 'ACCOUNT_ACTIVE'
        : user.status === UserStatus.INACTIVE || user.status === UserStatus.SUSPENDED
          ? 'ACCOUNT_INACTIVE'
          : invitation && invitation.expiresAt <= new Date() && !invitation.usedAt
            ? 'INVITATION_EXPIRED'
            : invitation?.deliveryStatus === 'SENT'
              ? 'INVITATION_SENT'
              : 'INVITATION_PENDING';
    return {
      ...profile,
      photoUrl: photoStorageKey
        ? `/service-providers/${profile.id}/photo?v=${profile.updatedAt.getTime()}`
        : profile.profileImageUrl,
      membership: safeMembership,
      user,
      accountStatus,
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
