import { Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  MembershipStatus,
  PlatformRole,
  TenantRole,
  TenantStatus,
  UserStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestWithContext } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

interface Principal {
  userId: string;
  tenantId: string | null;
  membershipId: string | null;
  platformRole: PlatformRole | null;
  tenantRole: TenantRole | null;
}

interface RefreshClaims {
  sub: string;
  sid: string;
  familyId: string;
  type: 'refresh';
  exp: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async login(dto: LoginDto, request: RequestWithContext) {
    const genericError = new UnauthorizedException('Invalid credentials or account unavailable');
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.trim().toLowerCase(), deletedAt: null },
      include: {
        memberships: {
          include: { tenant: true },
          where: { status: MembershipStatus.ACTIVE, tenant: { deletedAt: null } },
        },
      },
    });
    if (
      !user ||
      !(await bcrypt.compare(dto.password, user.passwordHash)) ||
      user.status !== UserStatus.ACTIVE
    ) {
      throw genericError;
    }
    let principal: Principal;
    if (user.platformRole === PlatformRole.SUPER_ADMIN && !dto.tenantSlug) {
      principal = {
        userId: user.id,
        tenantId: null,
        membershipId: null,
        platformRole: user.platformRole,
        tenantRole: null,
      };
    } else {
      const active = user.memberships.filter(
        (membership) => membership.tenant.status === TenantStatus.ACTIVE,
      );
      const selected = dto.tenantSlug
        ? active.find((membership) => membership.tenant.slug === dto.tenantSlug)
        : active.length === 1
          ? active[0]
          : undefined;
      if (!dto.tenantSlug && active.length > 1) {
        throw new UnprocessableEntityException({
          code: 'TENANT_SELECTION_REQUIRED',
          message: 'Tenant selection is required',
          details: active.map((membership) => ({
            name: membership.tenant.name,
            slug: membership.tenant.slug,
          })),
        });
      }
      if (!selected) throw genericError;
      principal = {
        userId: user.id,
        tenantId: selected.tenantId,
        membershipId: selected.id,
        platformRole: null,
        tenantRole: selected.role,
      };
    }
    const tokens = await this.issueTokenPair(principal, request);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      action: 'AUTH_LOGIN',
      entityType: 'User',
      entityId: user.id,
      tenantId: principal.tenantId,
      actorUserId: user.id,
      request,
    });
    return tokens;
  }

  async refresh(rawToken: string, request: RequestWithContext) {
    const unauthorized = new UnauthorizedException('Invalid or expired refresh token');
    let claims: RefreshClaims;
    try {
      claims = await this.jwt.verifyAsync<RefreshClaims>(rawToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
      if (claims.type !== 'refresh') throw new Error('Wrong token type');
    } catch {
      throw unauthorized;
    }
    const session = await this.prisma.refreshSession.findUnique({ where: { id: claims.sid } });
    if (!session || session.userId !== claims.sub || session.familyId !== claims.familyId)
      throw unauthorized;
    if (session.revokedAt || session.expiresAt <= new Date()) {
      await this.prisma.refreshSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw unauthorized;
    }
    if (!this.refreshTokenMatches(session.tokenHash, rawToken)) {
      await this.prisma.refreshSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw unauthorized;
    }
    const principal = await this.resolvePrincipal(session.userId, session.tenantId);
    const nextId = randomUUID();
    const nextRefresh = await this.signRefresh(principal.userId, nextId, session.familyId);
    const nextHash = this.hashRefreshToken(nextRefresh.token);
    const rotated = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: nextId },
      });
      if (revoked.count !== 1) return false;
      await tx.refreshSession.create({
        data: {
          id: nextId,
          familyId: session.familyId,
          userId: principal.userId,
          tenantId: principal.tenantId,
          tokenHash: nextHash,
          expiresAt: nextRefresh.expiresAt,
          ipAddress: request.ip,
          userAgent: request.get('user-agent'),
        },
      });
      return true;
    });
    if (!rotated) {
      await this.prisma.refreshSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw unauthorized;
    }
    return {
      accessToken: await this.signAccess(principal, nextId),
      refreshToken: nextRefresh.token,
      tokenType: 'Bearer',
      expiresIn: this.config.getOrThrow<string>('ACCESS_TOKEN_TTL'),
    };
  }

  async logout(auth: AuthContext, request: RequestWithContext): Promise<{ revoked: boolean }> {
    const result = await this.prisma.refreshSession.updateMany({
      where: { id: auth.sessionId, userId: auth.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      action: 'AUTH_LOGOUT',
      entityType: 'RefreshSession',
      entityId: auth.sessionId,
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      request,
    });
    return { revoked: result.count > 0 };
  }

  async logoutAll(
    auth: AuthContext,
    request: RequestWithContext,
  ): Promise<{ revokedSessions: number }> {
    const result = await this.prisma.refreshSession.updateMany({
      where: { userId: auth.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      action: 'AUTH_LOGOUT_ALL',
      entityType: 'User',
      entityId: auth.userId,
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      request,
    });
    return { revokedSessions: result.count };
  }

  async me(auth: AuthContext) {
    const branches = !auth.tenantId
      ? []
      : await this.prisma.branch.findMany({
          where: {
            tenantId: auth.tenantId,
            isActive: true,
            deletedAt: null,
            ...(auth.tenantRole === TenantRole.SALON_OWNER
              ? {}
              : { id: { in: auth.accessibleBranchIds } }),
          },
          select: {
            id: true,
            name: true,
            code: true,
            timezone: true,
            tenant: { select: { timezone: true } },
          },
          orderBy: { name: 'asc' },
        });
    return {
      user: {
        id: auth.userId,
        email: auth.email,
        firstName: auth.firstName,
        lastName: auth.lastName,
      },
      platformRole: auth.platformRole,
      tenant: auth.tenantId
        ? { id: auth.tenantId, slug: auth.tenantSlug, role: auth.tenantRole }
        : null,
      accessibleBranches: branches.map(({ tenant, ...branch }) => ({
        ...branch,
        timezone: branch.timezone ?? tenant.timezone,
      })),
    };
  }

  private async issueTokenPair(principal: Principal, request: RequestWithContext) {
    const id = randomUUID();
    const familyId = randomUUID();
    const refresh = await this.signRefresh(principal.userId, id, familyId);
    await this.prisma.refreshSession.create({
      data: {
        id,
        familyId,
        userId: principal.userId,
        tenantId: principal.tenantId,
        tokenHash: this.hashRefreshToken(refresh.token),
        expiresAt: refresh.expiresAt,
        ipAddress: request.ip,
        userAgent: request.get('user-agent'),
      },
    });
    return {
      accessToken: await this.signAccess(principal, id),
      refreshToken: refresh.token,
      tokenType: 'Bearer',
      expiresIn: this.config.getOrThrow<string>('ACCESS_TOKEN_TTL'),
    };
  }

  private signAccess(principal: Principal, sessionId: string): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: principal.userId,
        sid: sessionId,
        tenantId: principal.tenantId ?? undefined,
        membershipId: principal.membershipId ?? undefined,
        type: 'access',
      },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.getOrThrow<string>('ACCESS_TOKEN_TTL') as never,
      },
    );
  }

  private async signRefresh(userId: string, id: string, familyId: string) {
    const token = await this.jwt.signAsync(
      { sub: userId, sid: id, familyId, type: 'refresh' },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.getOrThrow<string>('REFRESH_TOKEN_TTL') as never,
      },
    );
    const decoded = this.jwt.decode<{ exp: number }>(token);
    return { token, expiresAt: new Date(decoded.exp * 1000) };
  }

  private async resolvePrincipal(userId: string, tenantId: string | null): Promise<Principal> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: UserStatus.ACTIVE, deletedAt: null },
      select: { platformRole: true },
    });
    if (!user) throw new UnauthorizedException('Account unavailable');
    if (!tenantId) {
      if (user.platformRole !== PlatformRole.SUPER_ADMIN)
        throw new UnauthorizedException('Account unavailable');
      return {
        userId,
        tenantId: null,
        membershipId: null,
        platformRole: user.platformRole,
        tenantRole: null,
      };
    }
    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        userId,
        tenantId,
        status: MembershipStatus.ACTIVE,
        tenant: { status: TenantStatus.ACTIVE, deletedAt: null },
      },
      select: { id: true, role: true },
    });
    if (!membership) throw new UnauthorizedException('Account unavailable');
    return {
      userId,
      tenantId,
      membershipId: membership.id,
      platformRole: null,
      tenantRole: membership.role,
    };
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private refreshTokenMatches(storedHash: string, token: string): boolean {
    const candidate = Buffer.from(this.hashRefreshToken(token), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    return candidate.length === stored.length && timingSafeEqual(candidate, stored);
  }
}
