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
  SERVICE_CATEGORY_CREATE = 'service-category:create',
  SERVICE_CATEGORY_READ = 'service-category:read',
  SERVICE_CATEGORY_UPDATE = 'service-category:update',
  SERVICE_CATEGORY_DEACTIVATE = 'service-category:deactivate',
  CATALOG_SERVICE_CREATE = 'catalog-service:create',
  CATALOG_SERVICE_READ = 'catalog-service:read',
  CATALOG_SERVICE_UPDATE = 'catalog-service:update',
  CATALOG_SERVICE_DEACTIVATE = 'catalog-service:deactivate',
  CATALOG_SERVICE_CONFIGURE_BRANCH = 'catalog-service:configure-branch',
  SERVICE_PROVIDER_CREATE = 'service-provider:create',
  SERVICE_PROVIDER_READ = 'service-provider:read',
  SERVICE_PROVIDER_UPDATE = 'service-provider:update',
  SERVICE_PROVIDER_DEACTIVATE = 'service-provider:deactivate',
  SERVICE_PROVIDER_MANAGE_QUALIFICATIONS = 'service-provider:manage-qualifications',
  CUSTOMER_CREATE = 'customer:create',
  CUSTOMER_READ = 'customer:read',
  CUSTOMER_UPDATE = 'customer:update',
  CUSTOMER_DEACTIVATE = 'customer:deactivate',
  PLATFORM_TENANT_CREATE = 'platform.tenant.create',
  PLATFORM_TENANT_VIEW = 'platform.tenant.view',
  PLATFORM_TENANT_UPDATE = 'platform.tenant.update',
  PLATFORM_TENANT_SUSPEND = 'platform.tenant.suspend',
  PLATFORM_TENANT_REACTIVATE = 'platform.tenant.reactivate',
}

const owner = Object.values(Permission).filter((permission) => !permission.startsWith('platform.'));

export const TENANT_ROLE_PERMISSIONS: Record<TenantRole, readonly Permission[]> = {
  SALON_OWNER: owner,
  RECEPTIONIST: [
    Permission.BRANCH_VIEW,
    Permission.PROFILE_VIEW_OWN,
    Permission.SERVICE_CATEGORY_READ,
    Permission.CATALOG_SERVICE_READ,
    Permission.SERVICE_PROVIDER_READ,
    Permission.CUSTOMER_CREATE,
    Permission.CUSTOMER_READ,
    Permission.CUSTOMER_UPDATE,
    Permission.CUSTOMER_DEACTIVATE,
  ],
  SERVICE_PROVIDER: [
    Permission.BRANCH_VIEW,
    Permission.PROFILE_VIEW_OWN,
    Permission.SERVICE_CATEGORY_READ,
    Permission.CATALOG_SERVICE_READ,
    Permission.SERVICE_PROVIDER_READ,
  ],
};

export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, readonly Permission[]> = {
  SUPER_ADMIN: Object.values(Permission).filter((permission) => permission.startsWith('platform.')),
};
