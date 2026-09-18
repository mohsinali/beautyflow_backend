import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { MembershipStatus, TenantStatus, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import type { RequestWithContext } from '../common/types/request-context';

interface AccessClaims {
  sub: string;
  sid: string;
  tenantId?: string;
  membershipId?: string;
  type: 'access';
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Authentication required');
    try {
      const claims = await this.jwt.verifyAsync<AccessClaims>(header.slice(7), {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      if (claims.type !== 'access') throw new Error('Wrong token type');
      const user = await this.prisma.user.findFirst({
        where: { id: claims.sub, status: UserStatus.ACTIVE, deletedAt: null },
        select: { id: true, email: true, firstName: true, lastName: true, platformRole: true },
      });
      if (!user) throw new Error('Inactive user');
      let membership = null;
      let tenant = null;
      let accessibleBranchIds: string[] = [];
      if (claims.tenantId || claims.membershipId) {
        if (!claims.tenantId || !claims.membershipId) throw new Error('Incomplete tenant context');
        membership = await this.prisma.tenantMembership.findFirst({
          where: {
            id: claims.membershipId,
            tenantId: claims.tenantId,
            userId: user.id,
            status: MembershipStatus.ACTIVE,
          },
          select: { id: true, role: true, branchAssignments: { select: { branchId: true } } },
        });
        tenant = await this.prisma.tenant.findFirst({
          where: { id: claims.tenantId, status: TenantStatus.ACTIVE, deletedAt: null },
          select: { id: true, slug: true },
        });
        if (!membership || !tenant) throw new Error('Inactive tenant context');
        accessibleBranchIds = membership.branchAssignments.map((item) => item.branchId);
      } else if (!user.platformRole) {
        throw new Error('Tenant context required');
      }
      request.auth = {
        userId: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        platformRole: user.platformRole,
        tenantId: tenant?.id ?? null,
        tenantSlug: tenant?.slug ?? null,
        membershipId: membership?.id ?? null,
        tenantRole: membership?.role ?? null,
        sessionId: claims.sid,
        accessibleBranchIds,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
