import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantRole } from '@prisma/client';
import { PermissionGuard } from './permission.guard';
import { Permission } from './permissions';

describe('PermissionGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const guard = new PermissionGuard(reflector);
  const context = (tenantRole: TenantRole) =>
    ({
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => ({ auth: { tenantRole, platformRole: null } }) }),
    }) as unknown as ExecutionContext;

  it('allows an owner to update tenant settings', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Permission.TENANT_SETTINGS_UPDATE]);
    expect(guard.canActivate(context(TenantRole.SALON_OWNER))).toBe(true);
  });

  it('denies a receptionist tenant administration', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Permission.TENANT_SETTINGS_UPDATE]);
    expect(() => guard.canActivate(context(TenantRole.RECEPTIONIST))).toThrow(ForbiddenException);
  });
});
