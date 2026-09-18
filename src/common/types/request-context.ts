import type { PlatformRole, TenantRole } from '@prisma/client';
import type { Request } from 'express';

export interface AuthContext {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  platformRole: PlatformRole | null;
  tenantId: string | null;
  tenantSlug: string | null;
  membershipId: string | null;
  tenantRole: TenantRole | null;
  sessionId: string;
  accessibleBranchIds: string[];
}

export interface RequestWithContext extends Request {
  requestId: string;
  auth?: AuthContext;
  branchId?: string;
}
