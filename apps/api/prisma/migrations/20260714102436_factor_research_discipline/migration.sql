-- AlterTable
ALTER TABLE "FactorReport" ADD COLUMN "holdoutPolicyJson" TEXT;
ALTER TABLE "FactorReport" ADD COLUMN "researchIntentJson" TEXT;
ALTER TABLE "FactorReport" ADD COLUMN "revealedAt" DATETIME;
ALTER TABLE "FactorReport" ADD COLUMN "testKey" TEXT;

-- CreateIndex
CREATE INDEX "FactorReport_userId_testKey_idx" ON "FactorReport"("userId", "testKey");

-- CreateIndex
CREATE INDEX "FactorReport_userId_parentReportId_phase_idx" ON "FactorReport"("userId", "parentReportId", "phase");
