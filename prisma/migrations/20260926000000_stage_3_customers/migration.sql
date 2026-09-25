CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "normalizedName" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(50),
    "normalizedPhone" VARCHAR(50),
    "notes" VARCHAR(2000),
    "preferredBranchId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Customer_id_tenantId_key" ON "Customer"("id", "tenantId");
CREATE INDEX "Customer_tenantId_isActive_normalizedName_idx" ON "Customer"("tenantId", "isActive", "normalizedName");
CREATE INDEX "Customer_tenantId_normalizedPhone_idx" ON "Customer"("tenantId", "normalizedPhone");
CREATE INDEX "Customer_preferredBranchId_tenantId_idx" ON "Customer"("preferredBranchId", "tenantId");
CREATE UNIQUE INDEX "Customer_active_phone_key" ON "Customer"("tenantId", "normalizedPhone")
  WHERE "isActive" = true AND "deletedAt" IS NULL AND "normalizedPhone" IS NOT NULL;

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_preferredBranchId_tenantId_fkey"
  FOREIGN KEY ("preferredBranchId", "tenantId") REFERENCES "Branch"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
