import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestWithContext } from '../common/types/request-context';
import { PERMISSIONS_KEY } from './authorization.decorators';
import { Permission, PLATFORM_ROLE_PERMISSIONS, TENANT_ROLE_PERMISSIONS } from './permissions';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const auth = context.switchToHttp().getRequest<RequestWithContext>().auth;
    if (!auth) throw new ForbiddenException();
    const granted = auth.platformRole
      ? PLATFORM_ROLE_PERMISSIONS[auth.platformRole]
      : auth.tenantRole
        ? TENANT_ROLE_PERMISSIONS[auth.tenantRole]
        : [];
    if (!required.every((permission) => granted.includes(permission))) {
      throw new ForbiddenException('Insufficient permission');
    }
    return true;
  }
}
