-- CreateTable
CREATE TABLE "FactorRelease" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "factorId" TEXT,
    "compositeId" TEXT,
    "sourceRef" TEXT NOT NULL,
    "releaseKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "inputDomains" JSONB NOT NULL,
    "targetAssetClasses" JSONB NOT NULL,
    "outputScope" TEXT NOT NULL,
    "codeSnapshot" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "approvedReportId" TEXT NOT NULL,
    "methodologySnapshot" JSONB NOT NULL,
    "maturity" TEXT NOT NULL,
    "lifecycle" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FactorRelease_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FactorRelease_factorId_fkey" FOREIGN KEY ("factorId") REFERENCES "Factor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FactorRelease_compositeId_fkey" FOREIGN KEY ("compositeId") REFERENCES "FactorComposite" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FactorRelease_approvedReportId_fkey" FOREIGN KEY ("approvedReportId") REFERENCES "FactorReport" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FactorReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "factor" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'done',
    "phase" TEXT NOT NULL DEFAULT 'legacy',
    "analysisKind" TEXT NOT NULL DEFAULT 'cross_sectional',
    "freq" TEXT NOT NULL,
    "neutral" TEXT NOT NULL DEFAULT 'none',
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "specJson" TEXT,
    "variantKey" TEXT,
    "factorCodeSnapshot" TEXT,
    "factorCodeHash" TEXT,
    "dataRevision" TEXT,
    "payload" TEXT,
    "error" TEXT,
    "parentReportId" TEXT,
    "testKey" TEXT,
    "researchIntentJson" TEXT,
    "holdoutPolicyJson" TEXT,
    "revealedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedAt" DATETIME
);
INSERT INTO "new_FactorReport" ("computedAt", "createdAt", "dataRevision", "end", "error", "factor", "factorCodeHash", "factorCodeSnapshot", "freq", "holdoutPolicyJson", "id", "neutral", "parentReportId", "payload", "phase", "researchIntentJson", "revealedAt", "specJson", "start", "status", "testKey", "userId", "variantKey") SELECT "computedAt", "createdAt", "dataRevision", "end", "error", "factor", "factorCodeHash", "factorCodeSnapshot", "freq", "holdoutPolicyJson", "id", "neutral", "parentReportId", "payload", "phase", "researchIntentJson", "revealedAt", "specJson", "start", "status", "testKey", "userId", "variantKey" FROM "FactorReport";
DROP TABLE "FactorReport";
ALTER TABLE "new_FactorReport" RENAME TO "FactorReport";
CREATE INDEX "FactorReport_userId_factor_createdAt_idx" ON "FactorReport"("userId", "factor", "createdAt");
CREATE INDEX "FactorReport_userId_variantKey_idx" ON "FactorReport"("userId", "variantKey");
CREATE INDEX "FactorReport_userId_testKey_idx" ON "FactorReport"("userId", "testKey");
CREATE INDEX "FactorReport_userId_parentReportId_phase_idx" ON "FactorReport"("userId", "parentReportId", "phase");
CREATE TABLE "new_FactorWeatherPin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "factorId" TEXT NOT NULL,
    "releaseId" TEXT,
    "factorName" TEXT NOT NULL,
    "builtin" BOOLEAN NOT NULL,
    "direction" TEXT NOT NULL,
    "factorCode" TEXT NOT NULL,
    "factorCodeHash" TEXT NOT NULL,
    "methodologyHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "computedThrough" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FactorWeatherPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FactorWeatherPin_factorId_fkey" FOREIGN KEY ("factorId") REFERENCES "Factor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FactorWeatherPin_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "FactorRelease" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FactorWeatherPin" ("builtin", "computedThrough", "createdAt", "direction", "error", "factorCode", "factorCodeHash", "factorId", "factorName", "id", "methodologyHash", "status", "updatedAt", "userId") SELECT "builtin", "computedThrough", "createdAt", "direction", "error", "factorCode", "factorCodeHash", "factorId", "factorName", "id", "methodologyHash", "status", "updatedAt", "userId" FROM "FactorWeatherPin";
DROP TABLE "FactorWeatherPin";
ALTER TABLE "new_FactorWeatherPin" RENAME TO "FactorWeatherPin";
CREATE INDEX "FactorWeatherPin_releaseId_idx" ON "FactorWeatherPin"("releaseId");
CREATE INDEX "FactorWeatherPin_status_updatedAt_idx" ON "FactorWeatherPin"("status", "updatedAt");
CREATE UNIQUE INDEX "FactorWeatherPin_userId_factorId_key" ON "FactorWeatherPin"("userId", "factorId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "FactorRelease_userId_lifecycle_createdAt_idx" ON "FactorRelease"("userId", "lifecycle", "createdAt");

-- CreateIndex
CREATE INDEX "FactorRelease_factorId_createdAt_idx" ON "FactorRelease"("factorId", "createdAt");

-- CreateIndex
CREATE INDEX "FactorRelease_compositeId_createdAt_idx" ON "FactorRelease"("compositeId", "createdAt");

-- CreateIndex
CREATE INDEX "FactorRelease_approvedReportId_idx" ON "FactorRelease"("approvedReportId");

-- CreateIndex
CREATE UNIQUE INDEX "FactorRelease_userId_releaseKey_version_key" ON "FactorRelease"("userId", "releaseKey", "version");
