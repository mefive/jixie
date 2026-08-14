-- AlterTable
ALTER TABLE "ResearchCuratorFinding" ADD COLUMN "verificationAssessedAt" DATETIME;
ALTER TABLE "ResearchCuratorFinding" ADD COLUMN "verificationAssessment" TEXT;

-- CreateTable
CREATE TABLE "TushareCapabilityProbe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogVersion" INTEGER NOT NULL,
    "apiName" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "probeDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "fields" JSONB NOT NULL,
    "historyField" TEXT,
    "historyStart" TEXT,
    "historyEnd" TEXT,
    "probeCoverage" TEXT,
    "errorCode" INTEGER,
    "errorMessage" TEXT,
    "probedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "TushareCapabilityProbe_apiName_probedAt_idx" ON "TushareCapabilityProbe"("apiName", "probedAt");

-- CreateIndex
CREATE INDEX "TushareCapabilityProbe_probedAt_idx" ON "TushareCapabilityProbe"("probedAt");
