import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InvitationDeliveryStatus,
  InvitationPurpose,
  MembershipStatus,
  Prisma,
  TenantRole,
  UserStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { RequestWithContext } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationEmailService } from './invitation-email.service';

export interface IssuedInvitation {
  id: string;
  token: string;
  expiresAt: Date;
}

type InvitationRecord = Prisma.AccountInvitationGetPayload<{
  include: { user: true; membership: true };
}>;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: InvitationEmailService,
    private readonly audit: AuditService,
  ) {}

  hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  async issue(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      tenantId: string;
      membershipId: string;
      purpose: InvitationPurpose;
      createdById: string;
      request: RequestWithContext;
      auditAction?: string;
    },
  ): Promise<IssuedInvitation> {
    const now = new Date();
    await tx.accountInvitation.updateMany({
      where: { membershipId: input.membershipId, usedAt: null, revokedAt: null },
      data: { revokedAt: now, activeKey: null },
    });
    const token = randomBytes(32).toString('base64url');
    const hours = this.config.get<number>('INVITATION_EXPIRY_HOURS', 48);
    const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
    const invitation = await tx.accountInvitation.create({
      data: {
        userId: input.userId,
        tenantId: input.tenantId,
        membershipId: input.membershipId,
        purpose: input.purpose,
        tokenHash: this.hash(token),
        activeKey: `${input.membershipId}:PROVIDER_ONBOARDING`,
        expiresAt,
        createdById: input.createdById,
      },
      select: { id: true },
    });
    await this.audit.record(
      {
        action: input.auditAction ?? 'PROVIDER_INVITATION_CREATED',
        entityType: 'AccountInvitation',
        entityId: invitation.id,
        tenantId: input.tenantId,
        actorUserId: input.createdById,
        metadata: { purpose: input.purpose, membershipId: input.membershipId },
        request: input.request,
      },
      tx,
    );
    return { id: invitation.id, token, expiresAt };
  }

  async deliver(invitation: IssuedInvitation): Promise<'SENT' | 'PENDING'> {
    const record = await this.prisma.accountInvitation.findUnique({
      where: { id: invitation.id },
      select: {
        id: true,
        tenantId: true,
        user: { select: { email: true } },
        membership: { select: { providerProfile: { select: { displayName: true } } } },
        tenant: { select: { name: true, defaultLanguage: true } },
      },
    });
    if (!record?.membership.providerProfile) return 'PENDING';
    const sent = await this.email.send({
      email: record.user.email,
      displayName: record.membership.providerProfile.displayName,
      tenantName: record.tenant.name,
      language: record.tenant.defaultLanguage,
      token: invitation.token,
      expiresAt: invitation.expiresAt,
    });
    if (sent)
      await this.prisma.accountInvitation.update({
        where: { id: invitation.id },
        data: { deliveryStatus: InvitationDeliveryStatus.SENT },
      });
    else
      await this.audit.record({
        action: 'PROVIDER_INVITATION_DELIVERY_FAILED',
        entityType: 'AccountInvitation',
        entityId: record.id,
        tenantId: record.tenantId,
        metadata: { channel: 'SES_SMTP' },
      });
    return sent ? 'SENT' : 'PENDING';
  }

  async validate(token: string) {
    const invitation = await this.findEligible(token);
    return {
      tenantName: invitation.tenant.name,
      role: TenantRole.SERVICE_PROVIDER,
      requiresPassword: !invitation.user.passwordHash,
    };
  }

  async accept(
    token: string,
    password: string | undefined,
    confirmPassword: string | undefined,
    request: RequestWithContext,
  ) {
    const tokenHash = this.hash(token);
    await this.prisma.$transaction(async (tx) => {
      const invitation = await tx.accountInvitation.findUnique({
        where: { tokenHash },
        include: { user: true, membership: true },
      });
      this.assertEligible(invitation);
      const validInvitation = invitation;
      const now = new Date();
      if (!validInvitation.user.passwordHash) {
        if (!password || password !== confirmPassword)
          throw new ConflictException({
            code: 'PASSWORDS_DO_NOT_MATCH',
            message: 'Passwords do not match',
          });
        await tx.user.update({
          where: { id: validInvitation.userId },
          data: { passwordHash: await bcrypt.hash(password, 12), status: UserStatus.ACTIVE },
        });
      } else if (validInvitation.user.status !== UserStatus.ACTIVE) {
        await tx.user.update({
          where: { id: validInvitation.userId },
          data: { status: UserStatus.ACTIVE },
        });
      }
      const used = await tx.accountInvitation.updateMany({
        where: { id: validInvitation.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now, activeKey: null },
      });
      if (used.count !== 1) throw this.invalid();
      await tx.accountInvitation.updateMany({
        where: {
          membershipId: validInvitation.membershipId,
          id: { not: validInvitation.id },
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now, activeKey: null },
      });
      await this.audit.record(
        {
          action: 'PROVIDER_INVITATION_ACCEPTED',
          entityType: 'AccountInvitation',
          entityId: validInvitation.id,
          tenantId: validInvitation.tenantId,
          actorUserId: validInvitation.userId,
          request,
        },
        tx,
      );
    });
    return { accepted: true };
  }

  private async findEligible(token: string) {
    const invitation = await this.prisma.accountInvitation.findUnique({
      where: { tokenHash: this.hash(token) },
      include: { user: true, membership: true, tenant: { select: { name: true } } },
    });
    this.assertEligible(invitation);
    return invitation;
  }

  private assertEligible(
    invitation: InvitationRecord | null,
  ): asserts invitation is InvitationRecord {
    if (!invitation) throw this.invalid('INVITATION_INVALID');
    if (invitation.usedAt) throw this.invalid('INVITATION_ALREADY_USED');
    if (invitation.expiresAt <= new Date()) throw this.invalid('INVITATION_EXPIRED');
    if (
      invitation.revokedAt ||
      invitation.user.deletedAt ||
      (invitation.user.status !== UserStatus.ACTIVE &&
        invitation.user.status !== UserStatus.INVITED) ||
      invitation.membership.status !== MembershipStatus.ACTIVE ||
      invitation.membership.role !== TenantRole.SERVICE_PROVIDER
    )
      throw this.invalid('INVITATION_INVALID');
  }

  private invalid(code = 'INVITATION_INVALID') {
    return new UnauthorizedException({ code, message: 'Invitation is invalid or unavailable' });
  }
}
