CREATE INDEX "Visit_tenantId_branchId_paymentStatus_paidAt_idx"
ON "Visit"("tenantId", "branchId", "paymentStatus", "paidAt");

CREATE INDEX "Visit_tenantId_branchId_status_completedAt_idx"
ON "Visit"("tenantId", "branchId", "status", "completedAt");

CREATE INDEX "VisitItem_tenantId_status_completedAt_idx"
ON "VisitItem"("tenantId", "status", "completedAt");
