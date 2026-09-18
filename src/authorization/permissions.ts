import type { PlatformRole, TenantRole } from '@prisma/client';

export enum Permission {
  TENANT_SETTINGS_VIEW = 'tenant.settings.view',
  TENANT_SETTINGS_UPDATE = 'tenant.settings.update',
  BRANCH_CREATE = 'branch.create',
  BRANCH_VIEW = 'branch.view',
  BRANCH_UPDATE = 'branch.update',
  BRANCH_DEACTIVATE = 'branch.deactivate',
  STAFF_CREATE = 'staff.create',
  STAFF_VIEW = 'staff.view',
  STAFF_UPDATE = 'staff.update',
  STAFF_SUSPEND = 'staff.suspend',
  MEMBERSHIP_ROLE_ASSIGN = 'membership.role.assign',
  BRANCH_ACCESS_ASSIGN = 'branch.access.assign',
  PROFILE_VIEW_OWN = 'profile.view.own',
  PLATFORM_TENANT_CREATE = 'platform.tenant.create',
  PLATFORM_TENANT_VIEW = 'platform.tenant.view',
  PLATFORM_TENANT_UPDATE = 'platform.tenant.update',
  PLATFORM_TENANT_SUSPEND = 'platform.tenant.suspend',
  PLATFORM_TENANT_REACTIVATE = 'platform.tenant.reactivate',
}

const owner = Object.values(Permission).filter((permission) => !permission.startsWith('platform.'));

export const TENANT_ROLE_PERMISSIONS: Record<TenantRole, readonly Permission[]> = {
  SALON_OWNER: owner,
  RECEPTIONIST: [Permission.BRANCH_VIEW, Permission.PROFILE_VIEW_OWN],
  SERVICE_PROVIDER: [Permission.BRANCH_VIEW, Permission.PROFILE_VIEW_OWN],
};

export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, readonly Permission[]> = {
  SUPER_ADMIN: Object.values(Permission).filter((permission) => permission.startsWith('platform.')),
};
