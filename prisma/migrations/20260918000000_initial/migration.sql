CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TYPE "Language" AS ENUM ('EN', 'AR');
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED', 'INACTIVE');
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN');
CREATE TYPE "TenantRole" AS ENUM ('SALON_OWNER', 'RECEPTIONIST', 'SERVICE_PROVIDER');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED', 'INACTIVE');

CREATE TABLE "Tenant" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "name" TEXT NOT NULL, "slug" TEXT NOT NULL, "defaultLanguage" "Language" NOT NULL DEFAULT 'EN', "currencyCode" VARCHAR(3) NOT NULL, "timezone" TEXT NOT NULL, "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE', "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL, "deletedAt" TIMESTAMPTZ(3));
CREATE TABLE "Branch" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL, "name" TEXT NOT NULL, "code" TEXT NOT NULL, "phone" TEXT, "email" TEXT, "address" TEXT, "city" TEXT, "timezone" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL, "deletedAt" TIMESTAMPTZ(3));
CREATE TABLE "User" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "email" TEXT NOT NULL, "firstName" TEXT NOT NULL, "lastName" TEXT NOT NULL, "passwordHash" TEXT NOT NULL, "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE', "platformRole" "PlatformRole", "lastLoginAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL, "deletedAt" TIMESTAMPTZ(3));
CREATE TABLE "TenantMembership" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL, "userId" UUID NOT NULL, "role" "TenantRole" NOT NULL, "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE', "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL);
CREATE TABLE "MembershipBranch" ("membershipId" UUID NOT NULL, "branchId" UUID NOT NULL, "tenantId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("membershipId", "branchId"));
CREATE TABLE "RefreshSession" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "familyId" UUID NOT NULL, "userId" UUID NOT NULL, "tenantId" UUID, "tokenHash" TEXT NOT NULL, "expiresAt" TIMESTAMPTZ(3) NOT NULL, "revokedAt" TIMESTAMPTZ(3), "replacedById" UUID, "ipAddress" TEXT, "userAgent" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL);
CREATE TABLE "AuditLog" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID, "branchId" UUID, "actorUserId" UUID, "action" TEXT NOT NULL, "entityType" TEXT NOT NULL, "entityId" TEXT, "metadata" JSONB, "ipAddress" TEXT, "userAgent" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
CREATE INDEX "Tenant_status_deletedAt_idx" ON "Tenant"("status", "deletedAt");
CREATE UNIQUE INDEX "Branch_tenantId_code_key" ON "Branch"("tenantId", "code");
CREATE UNIQUE INDEX "Branch_id_tenantId_key" ON "Branch"("id", "tenantId");
CREATE INDEX "Branch_tenantId_isActive_deletedAt_idx" ON "Branch"("tenantId", "isActive", "deletedAt");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_status_deletedAt_idx" ON "User"("status", "deletedAt");
CREATE UNIQUE INDEX "TenantMembership_tenantId_userId_key" ON "TenantMembership"("tenantId", "userId");
CREATE UNIQUE INDEX "TenantMembership_id_tenantId_key" ON "TenantMembership"("id", "tenantId");
CREATE INDEX "TenantMembership_tenantId_status_role_idx" ON "TenantMembership"("tenantId", "status", "role");
CREATE INDEX "TenantMembership_userId_status_idx" ON "TenantMembership"("userId", "status");
CREATE INDEX "MembershipBranch_tenantId_branchId_idx" ON "MembershipBranch"("tenantId", "branchId");
CREATE INDEX "RefreshSession_userId_revokedAt_expiresAt_idx" ON "RefreshSession"("userId", "revokedAt", "expiresAt");
CREATE INDEX "RefreshSession_familyId_idx" ON "RefreshSession"("familyId");
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

ALTER TABLE "Branch" ADD CONSTRAINT "Branch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT;
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "MembershipBranch" ADD CONSTRAINT "MembershipBranch_membershipId_tenantId_fkey" FOREIGN KEY ("membershipId", "tenantId") REFERENCES "TenantMembership"("id", "tenantId") ON DELETE CASCADE;
ALTER TABLE "MembershipBranch" ADD CONSTRAINT "MembershipBranch_branchId_tenantId_fkey" FOREIGN KEY ("branchId", "tenantId") REFERENCES "Branch"("id", "tenantId") ON DELETE CASCADE;
ALTER TABLE "MembershipBranch" ADD CONSTRAINT "MembershipBranch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL;

-- Enforce case-insensitive login identity while retaining normalized email strings.
CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (LOWER("email"));
