CREATE TYPE "VisitStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "VisitItemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TABLE "Visit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL, "branchId" UUID NOT NULL,
  "customerId" UUID NOT NULL, "defaultProviderId" UUID, "status" "VisitStatus" NOT NULL DEFAULT 'DRAFT',
  "subtotal" DECIMAL(12,2) NOT NULL, "discountAmount" DECIMAL(12,2) NOT NULL, "total" DECIMAL(12,2) NOT NULL,
  "notes" VARCHAR(2000), "startedAt" TIMESTAMPTZ(3), "completedAt" TIMESTAMPTZ(3), "cancelledAt" TIMESTAMPTZ(3),
  "createdByUserId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "VisitItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL, "visitId" UUID NOT NULL,
  "catalogServiceId" UUID NOT NULL, "providerId" UUID, "serviceNameSnapshot" VARCHAR(160) NOT NULL,
  "originalPrice" DECIMAL(12,2) NOT NULL, "chargedPrice" DECIMAL(12,2) NOT NULL, "discountAmount" DECIMAL(12,2) NOT NULL,
  "status" "VisitItemStatus" NOT NULL DEFAULT 'PENDING', "startedAt" TIMESTAMPTZ(3), "completedAt" TIMESTAMPTZ(3),
  "cancelledAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "VisitItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Visit_id_tenantId_key" ON "Visit"("id", "tenantId");
CREATE INDEX "Visit_tenantId_branchId_status_createdAt_idx" ON "Visit"("tenantId", "branchId", "status", "createdAt");
CREATE INDEX "Visit_tenantId_customerId_createdAt_idx" ON "Visit"("tenantId", "customerId", "createdAt");
CREATE UNIQUE INDEX "VisitItem_id_tenantId_key" ON "VisitItem"("id", "tenantId");
CREATE INDEX "VisitItem_tenantId_visitId_status_idx" ON "VisitItem"("tenantId", "visitId", "status");
CREATE INDEX "VisitItem_tenantId_providerId_status_idx" ON "VisitItem"("tenantId", "providerId", "status");
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_branchId_tenantId_fkey" FOREIGN KEY ("branchId", "tenantId") REFERENCES "Branch"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "Customer"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_defaultProviderId_tenantId_fkey" FOREIGN KEY ("defaultProviderId", "tenantId") REFERENCES "ServiceProviderProfile"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitItem" ADD CONSTRAINT "VisitItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitItem" ADD CONSTRAINT "VisitItem_visitId_tenantId_fkey" FOREIGN KEY ("visitId", "tenantId") REFERENCES "Visit"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitItem" ADD CONSTRAINT "VisitItem_catalogServiceId_tenantId_fkey" FOREIGN KEY ("catalogServiceId", "tenantId") REFERENCES "CatalogService"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitItem" ADD CONSTRAINT "VisitItem_providerId_tenantId_fkey" FOREIGN KEY ("providerId", "tenantId") REFERENCES "ServiceProviderProfile"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
