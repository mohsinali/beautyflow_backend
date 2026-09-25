CREATE TYPE "InvitationPurpose" AS ENUM ('PASSWORD_SETUP', 'TENANT_PROVIDER_INVITE');
CREATE TYPE "InvitationDeliveryStatus" AS ENUM ('PENDING', 'SENT');

ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

CREATE TABLE "AccountInvitation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "purpose" "InvitationPurpose" NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "activeKey" VARCHAR(255),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "deliveryStatus" "InvitationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    CONSTRAINT "AccountInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountInvitation_tokenHash_key" ON "AccountInvitation"("tokenHash");
CREATE UNIQUE INDEX "AccountInvitation_activeKey_key" ON "AccountInvitation"("activeKey");
CREATE INDEX "AccountInvitation_membershipId_createdAt_idx" ON "AccountInvitation"("membershipId", "createdAt");
CREATE INDEX "AccountInvitation_expiresAt_usedAt_revokedAt_idx" ON "AccountInvitation"("expiresAt", "usedAt", "revokedAt");

ALTER TABLE "AccountInvitation" ADD CONSTRAINT "AccountInvitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountInvitation" ADD CONSTRAINT "AccountInvitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountInvitation" ADD CONSTRAINT "AccountInvitation_membershipId_tenantId_fkey" FOREIGN KEY ("membershipId", "tenantId") REFERENCES "TenantMembership"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountInvitation" ADD CONSTRAINT "AccountInvitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
