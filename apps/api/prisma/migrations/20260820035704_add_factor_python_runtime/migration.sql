-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Factor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "analysisKind" TEXT NOT NULL DEFAULT 'cross_sectional',
    "language" TEXT NOT NULL DEFAULT 'typescript',
    "runtimeVersion" TEXT NOT NULL DEFAULT 'ts-v1',
    "descriptionZh" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL,
    "messages" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "approvedReportId" TEXT,
    "sourceResearchExecutionId" TEXT,
    "researchHandoff" JSONB,
    "codeHash" TEXT,
    "publishedAt" DATETIME,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Factor_approvedReportId_fkey" FOREIGN KEY ("approvedReportId") REFERENCES "FactorReport" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Factor_sourceResearchExecutionId_fkey" FOREIGN KEY ("sourceResearchExecutionId") REFERENCES "ResearchExecution" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Factor" ("analysisKind", "approvedReportId", "archivedAt", "code", "codeHash", "createdAt", "descriptionEn", "descriptionZh", "id", "key", "messages", "name", "publishedAt", "researchHandoff", "sourceResearchExecutionId", "status", "updatedAt", "userId", "visibility") SELECT "analysisKind", "approvedReportId", "archivedAt", "code", "codeHash", "createdAt", "descriptionEn", "descriptionZh", "id", "key", "messages", "name", "publishedAt", "researchHandoff", "sourceResearchExecutionId", "status", "updatedAt", "userId", "visibility" FROM "Factor";
DROP TABLE "Factor";
ALTER TABLE "new_Factor" RENAME TO "Factor";
CREATE UNIQUE INDEX "Factor_approvedReportId_key" ON "Factor"("approvedReportId");
CREATE UNIQUE INDEX "Factor_sourceResearchExecutionId_key" ON "Factor"("sourceResearchExecutionId");
CREATE INDEX "Factor_userId_updatedAt_idx" ON "Factor"("userId", "updatedAt");
CREATE INDEX "Factor_visibility_status_updatedAt_idx" ON "Factor"("visibility", "status", "updatedAt");
CREATE UNIQUE INDEX "Factor_userId_key_key" ON "Factor"("userId", "key");
CREATE TABLE "new_FactorReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "factor" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'done',
    "phase" TEXT NOT NULL DEFAULT 'legacy',
    "analysisKind" TEXT NOT NULL DEFAULT 'cross_sectional',
    "language" TEXT NOT NULL DEFAULT 'typescript',
    "runtimeVersion" TEXT NOT NULL DEFAULT 'ts-v1',
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
INSERT INTO "new_FactorReport" ("analysisKind", "computedAt", "createdAt", "dataRevision", "end", "error", "factor", "factorCodeHash", "factorCodeSnapshot", "freq", "holdoutPolicyJson", "id", "neutral", "parentReportId", "payload", "phase", "researchIntentJson", "revealedAt", "specJson", "start", "status", "testKey", "userId", "variantKey") SELECT "analysisKind", "computedAt", "createdAt", "dataRevision", "end", "error", "factor", "factorCodeHash", "factorCodeSnapshot", "freq", "holdoutPolicyJson", "id", "neutral", "parentReportId", "payload", "phase", "researchIntentJson", "revealedAt", "specJson", "start", "status", "testKey", "userId", "variantKey" FROM "FactorReport";
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
    "factorName" TEXT NOT NULL,
    "builtin" BOOLEAN NOT NULL,
    "direction" TEXT NOT NULL,
    "factorCode" TEXT NOT NULL,
    "factorCodeHash" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'typescript',
    "runtimeVersion" TEXT NOT NULL DEFAULT 'ts-v1',
    "methodologyHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "computedThrough" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FactorWeatherPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FactorWeatherPin_factorId_fkey" FOREIGN KEY ("factorId") REFERENCES "Factor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_FactorWeatherPin" ("builtin", "computedThrough", "createdAt", "direction", "error", "factorCode", "factorCodeHash", "factorId", "factorName", "id", "methodologyHash", "status", "updatedAt", "userId") SELECT "builtin", "computedThrough", "createdAt", "direction", "error", "factorCode", "factorCodeHash", "factorId", "factorName", "id", "methodologyHash", "status", "updatedAt", "userId" FROM "FactorWeatherPin";
DROP TABLE "FactorWeatherPin";
ALTER TABLE "new_FactorWeatherPin" RENAME TO "FactorWeatherPin";
CREATE INDEX "FactorWeatherPin_status_updatedAt_idx" ON "FactorWeatherPin"("status", "updatedAt");
CREATE UNIQUE INDEX "FactorWeatherPin_userId_factorId_key" ON "FactorWeatherPin"("userId", "factorId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
