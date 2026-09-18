import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { TenantRole } from '@prisma/client';
import type { RequestWithContext } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BranchContextGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const auth = request.auth;
    if (!auth?.tenantId) return true;
    const requested = request.headers['x-branch-id'];
    if (Array.isArray(requested)) throw new NotFoundException('Branch not found');
    let branchId = requested;
    if (
      !branchId &&
      auth.tenantRole !== TenantRole.SALON_OWNER &&
      auth.accessibleBranchIds.length === 1
    ) {
      [branchId] = auth.accessibleBranchIds;
    }
    if (!branchId) return true;
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId: auth.tenantId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    const permitted =
      auth.tenantRole === TenantRole.SALON_OWNER || auth.accessibleBranchIds.includes(branchId);
    if (!branch || !permitted) throw new NotFoundException('Branch not found');
    request.branchId = branch.id;
    return true;
  }
}
