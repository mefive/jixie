-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BacktestReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "strategyName" TEXT NOT NULL,
    "status" TEXT,
    "config" JSONB NOT NULL,
    "codeHash" TEXT,
    "resultHash" TEXT,
    "payload" JSONB,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedAt" DATETIME,
    CONSTRAINT "BacktestReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BacktestReport_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BacktestReport" ("codeHash", "computedAt", "config", "createdAt", "error", "id", "payload", "resultHash", "status", "strategyId", "strategyName", "userId") SELECT "codeHash", "computedAt", "config", "createdAt", "error", "id", "payload", "resultHash", "status", "strategyId", "strategyName", "userId" FROM "BacktestReport";
DROP TABLE "BacktestReport";
ALTER TABLE "new_BacktestReport" RENAME TO "BacktestReport";
CREATE INDEX "BacktestReport_userId_strategyId_createdAt_idx" ON "BacktestReport"("userId", "strategyId", "createdAt");
CREATE INDEX "BacktestReport_userId_status_createdAt_idx" ON "BacktestReport"("userId", "status", "createdAt");
CREATE TABLE "new_FactorReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "factor" TEXT NOT NULL,
    "status" TEXT,
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
INSERT INTO "new_FactorReport" ("analysisKind", "computedAt", "createdAt", "dataRevision", "end", "error", "factor", "factorCodeHash", "factorCodeSnapshot", "freq", "holdoutPolicyJson", "id", "language", "neutral", "parentReportId", "payload", "phase", "researchIntentJson", "revealedAt", "runtimeVersion", "specJson", "start", "status", "testKey", "userId", "variantKey") SELECT "analysisKind", "computedAt", "createdAt", "dataRevision", "end", "error", "factor", "factorCodeHash", "factorCodeSnapshot", "freq", "holdoutPolicyJson", "id", "language", "neutral", "parentReportId", "payload", "phase", "researchIntentJson", "revealedAt", "runtimeVersion", "specJson", "start", "status", "testKey", "userId", "variantKey" FROM "FactorReport";
DROP TABLE "FactorReport";
ALTER TABLE "new_FactorReport" RENAME TO "FactorReport";
CREATE INDEX "FactorReport_userId_factor_createdAt_idx" ON "FactorReport"("userId", "factor", "createdAt");
CREATE INDEX "FactorReport_userId_variantKey_idx" ON "FactorReport"("userId", "variantKey");
CREATE INDEX "FactorReport_userId_testKey_idx" ON "FactorReport"("userId", "testKey");
CREATE INDEX "FactorReport_userId_parentReportId_phase_idx" ON "FactorReport"("userId", "parentReportId", "phase");
CREATE TABLE "new_ResearchCuratorRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "status" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "cursorFrom" DATETIME,
    "cursorTo" DATETIME NOT NULL,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "findingsCreated" INTEGER NOT NULL DEFAULT 0,
    "duplicatesSkipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchCuratorRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ResearchCuratorRun" ("createdAt", "cursorFrom", "cursorTo", "duplicatesSkipped", "error", "evidenceCount", "findingsCreated", "id", "status", "trigger", "updatedAt", "userId") SELECT "createdAt", "cursorFrom", "cursorTo", "duplicatesSkipped", "error", "evidenceCount", "findingsCreated", "id", "status", "trigger", "updatedAt", "userId" FROM "ResearchCuratorRun";
DROP TABLE "ResearchCuratorRun";
ALTER TABLE "new_ResearchCuratorRun" RENAME TO "ResearchCuratorRun";
CREATE INDEX "ResearchCuratorRun_userId_createdAt_idx" ON "ResearchCuratorRun"("userId", "createdAt");
CREATE INDEX "ResearchCuratorRun_userId_status_createdAt_idx" ON "ResearchCuratorRun"("userId", "status", "createdAt");
CREATE TABLE "new_SignalRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "execDate" TEXT NOT NULL,
    "status" TEXT,
    "factorDependencies" JSONB,
    "factorInputs" JSONB,
    "dataCutoff" TEXT,
    "modelEquity" REAL,
    "modelCash" REAL,
    "modelPositions" JSONB,
    "signals" JSONB,
    "error" TEXT,
    "notifiedAt" DATETIME,
    "notificationError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SignalRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SignalRun_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "StrategyDeployment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SignalRun" ("createdAt", "dataCutoff", "deploymentId", "error", "execDate", "factorDependencies", "factorInputs", "id", "modelCash", "modelEquity", "modelPositions", "notificationError", "notifiedAt", "signals", "status", "strategyId", "tradeDate", "updatedAt", "userId") SELECT "createdAt", "dataCutoff", "deploymentId", "error", "execDate", "factorDependencies", "factorInputs", "id", "modelCash", "modelEquity", "modelPositions", "notificationError", "notifiedAt", "signals", "status", "strategyId", "tradeDate", "updatedAt", "userId" FROM "SignalRun";
DROP TABLE "SignalRun";
ALTER TABLE "new_SignalRun" RENAME TO "SignalRun";
CREATE INDEX "SignalRun_userId_tradeDate_idx" ON "SignalRun"("userId", "tradeDate");
CREATE INDEX "SignalRun_strategyId_tradeDate_idx" ON "SignalRun"("strategyId", "tradeDate");
CREATE INDEX "SignalRun_status_idx" ON "SignalRun"("status");
CREATE UNIQUE INDEX "SignalRun_deploymentId_tradeDate_key" ON "SignalRun"("deploymentId", "tradeDate");
CREATE TABLE "new_StrategyScanReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "strategyName" TEXT NOT NULL,
    "status" TEXT,
    "config" JSONB NOT NULL,
    "spec" JSONB NOT NULL,
    "codeHash" TEXT NOT NULL,
    "dataCutoff" TEXT,
    "payload" JSONB,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StrategyScanReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StrategyScanReport_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_StrategyScanReport" ("codeHash", "config", "createdAt", "dataCutoff", "error", "id", "payload", "spec", "status", "strategyId", "strategyName", "updatedAt", "userId") SELECT "codeHash", "config", "createdAt", "dataCutoff", "error", "id", "payload", "spec", "status", "strategyId", "strategyName", "updatedAt", "userId" FROM "StrategyScanReport";
DROP TABLE "StrategyScanReport";
ALTER TABLE "new_StrategyScanReport" RENAME TO "StrategyScanReport";
CREATE INDEX "StrategyScanReport_userId_strategyId_createdAt_idx" ON "StrategyScanReport"("userId", "strategyId", "createdAt");
CREATE INDEX "StrategyScanReport_userId_status_idx" ON "StrategyScanReport"("userId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
