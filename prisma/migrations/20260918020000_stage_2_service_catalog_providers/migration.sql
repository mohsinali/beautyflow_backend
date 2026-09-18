CREATE TABLE "ServiceCategory" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL, "normalizedName" VARCHAR(120) NOT NULL,
  "description" VARCHAR(1000), "color" VARCHAR(7), "iconKey" VARCHAR(50),
  "sortOrder" INTEGER NOT NULL DEFAULT 0, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL, "deletedAt" TIMESTAMPTZ(3)
);

CREATE TABLE "CatalogService" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL,
  "categoryId" UUID NOT NULL, "name" VARCHAR(160) NOT NULL,
  "normalizedName" VARCHAR(160) NOT NULL, "description" VARCHAR(2000),
  "code" VARCHAR(50), "defaultPrice" DECIMAL(12,2) NOT NULL,
  "durationMinutes" INTEGER, "color" VARCHAR(7), "iconKey" VARCHAR(50),
  "sortOrder" INTEGER NOT NULL DEFAULT 0, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL, "deletedAt" TIMESTAMPTZ(3)
);

CREATE TABLE "BranchService" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL,
  "branchId" UUID NOT NULL, "catalogServiceId" UUID NOT NULL,
  "isAvailable" BOOLEAN NOT NULL DEFAULT true, "priceOverride" DECIMAL(12,2),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);

CREATE TABLE "ServiceProviderProfile" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL,
  "membershipId" UUID NOT NULL, "displayName" VARCHAR(160) NOT NULL,
  "normalizedName" VARCHAR(160) NOT NULL, "phone" VARCHAR(50),
  "jobTitle" VARCHAR(120), "bio" VARCHAR(2000), "profileImageUrl" VARCHAR(2048),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL, "deletedAt" TIMESTAMPTZ(3)
);

CREATE TABLE "ProviderService" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL,
  "providerProfileId" UUID NOT NULL, "catalogServiceId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "ServiceCategory_id_tenantId_key" ON "ServiceCategory"("id", "tenantId");
CREATE UNIQUE INDEX "ServiceCategory_active_normalizedName_key" ON "ServiceCategory"("tenantId", "normalizedName") WHERE "isActive" = true AND "deletedAt" IS NULL;
CREATE INDEX "ServiceCategory_tenantId_isActive_sortOrder_idx" ON "ServiceCategory"("tenantId", "isActive", "sortOrder");
CREATE INDEX "ServiceCategory_tenantId_normalizedName_idx" ON "ServiceCategory"("tenantId", "normalizedName");
CREATE UNIQUE INDEX "CatalogService_id_tenantId_key" ON "CatalogService"("id", "tenantId");
CREATE UNIQUE INDEX "CatalogService_active_normalizedName_key" ON "CatalogService"("tenantId", "categoryId", "normalizedName") WHERE "isActive" = true AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "CatalogService_tenantId_code_key" ON "CatalogService"("tenantId", "code");
CREATE INDEX "CatalogService_tenantId_categoryId_isActive_sortOrder_idx" ON "CatalogService"("tenantId", "categoryId", "isActive", "sortOrder");
CREATE INDEX "CatalogService_tenantId_normalizedName_idx" ON "CatalogService"("tenantId", "normalizedName");
CREATE UNIQUE INDEX "BranchService_branchId_catalogServiceId_key" ON "BranchService"("branchId", "catalogServiceId");
CREATE INDEX "BranchService_tenantId_branchId_isAvailable_idx" ON "BranchService"("tenantId", "branchId", "isAvailable");
CREATE INDEX "BranchService_tenantId_catalogServiceId_idx" ON "BranchService"("tenantId", "catalogServiceId");
CREATE UNIQUE INDEX "ServiceProviderProfile_id_tenantId_key" ON "ServiceProviderProfile"("id", "tenantId");
CREATE UNIQUE INDEX "ServiceProviderProfile_membershipId_key" ON "ServiceProviderProfile"("membershipId");
CREATE UNIQUE INDEX "ServiceProviderProfile_membershipId_tenantId_key" ON "ServiceProviderProfile"("membershipId", "tenantId");
CREATE INDEX "ServiceProviderProfile_tenantId_isActive_normalizedName_idx" ON "ServiceProviderProfile"("tenantId", "isActive", "normalizedName");
CREATE UNIQUE INDEX "ProviderService_providerProfileId_catalogServiceId_key" ON "ProviderService"("providerProfileId", "catalogServiceId");
CREATE INDEX "ProviderService_tenantId_catalogServiceId_idx" ON "ProviderService"("tenantId", "catalogServiceId");
CREATE INDEX "ProviderService_tenantId_providerProfileId_idx" ON "ProviderService"("tenantId", "providerProfileId");

ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogService" ADD CONSTRAINT "CatalogService_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogService" ADD CONSTRAINT "CatalogService_categoryId_tenantId_fkey" FOREIGN KEY ("categoryId", "tenantId") REFERENCES "ServiceCategory"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchService" ADD CONSTRAINT "BranchService_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BranchService" ADD CONSTRAINT "BranchService_branchId_tenantId_fkey" FOREIGN KEY ("branchId", "tenantId") REFERENCES "Branch"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BranchService" ADD CONSTRAINT "BranchService_catalogServiceId_tenantId_fkey" FOREIGN KEY ("catalogServiceId", "tenantId") REFERENCES "CatalogService"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceProviderProfile" ADD CONSTRAINT "ServiceProviderProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceProviderProfile" ADD CONSTRAINT "ServiceProviderProfile_membershipId_tenantId_fkey" FOREIGN KEY ("membershipId", "tenantId") REFERENCES "TenantMembership"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderService" ADD CONSTRAINT "ProviderService_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderService" ADD CONSTRAINT "ProviderService_providerProfileId_tenantId_fkey" FOREIGN KEY ("providerProfileId", "tenantId") REFERENCES "ServiceProviderProfile"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderService" ADD CONSTRAINT "ProviderService_catalogServiceId_tenantId_fkey" FOREIGN KEY ("catalogServiceId", "tenantId") REFERENCES "CatalogService"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_sortOrder_check" CHECK ("sortOrder" >= 0);
ALTER TABLE "CatalogService" ADD CONSTRAINT "CatalogService_defaultPrice_check" CHECK ("defaultPrice" >= 0);
ALTER TABLE "CatalogService" ADD CONSTRAINT "CatalogService_durationMinutes_check" CHECK ("durationMinutes" IS NULL OR "durationMinutes" > 0);
ALTER TABLE "CatalogService" ADD CONSTRAINT "CatalogService_sortOrder_check" CHECK ("sortOrder" >= 0);
ALTER TABLE "BranchService" ADD CONSTRAINT "BranchService_priceOverride_check" CHECK ("priceOverride" IS NULL OR "priceOverride" >= 0);
