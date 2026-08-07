-- DropIndex
DROP INDEX "FactorRelease_userId_releaseKey_version_key";

-- DropIndex
DROP INDEX "FactorRelease_approvedReportId_idx";

-- DropIndex
DROP INDEX "FactorRelease_compositeId_createdAt_idx";

-- DropIndex
DROP INDEX "FactorRelease_factorId_createdAt_idx";

-- DropIndex
DROP INDEX "FactorRelease_userId_lifecycle_createdAt_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "FactorRelease";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Factor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "analysisKind" TEXT NOT NULL DEFAULT 'cross_sectional',
    "descriptionZh" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL,
    "messages" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvedReportId" TEXT,
    "codeHash" TEXT,
    "publishedAt" DATETIME,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Factor_approvedReportId_fkey" FOREIGN KEY ("approvedReportId") REFERENCES "FactorReport" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Factor" ("analysisKind", "code", "createdAt", "descriptionEn", "descriptionZh", "id", "key", "messages", "name", "updatedAt", "userId") SELECT "analysisKind", "code", "createdAt", "descriptionEn", "descriptionZh", "id", "key", "messages", "name", "updatedAt", "userId" FROM "Factor";
DROP TABLE "Factor";
ALTER TABLE "new_Factor" RENAME TO "Factor";
CREATE UNIQUE INDEX "Factor_approvedReportId_key" ON "Factor"("approvedReportId");
CREATE INDEX "Factor_userId_updatedAt_idx" ON "Factor"("userId", "updatedAt");
CREATE UNIQUE INDEX "Factor_userId_key_key" ON "Factor"("userId", "key");
CREATE TABLE "new_FactorWeatherPin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "factorId" TEXT NOT NULL,
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
    CONSTRAINT "FactorWeatherPin_factorId_fkey" FOREIGN KEY ("factorId") REFERENCES "Factor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_FactorWeatherPin" ("builtin", "computedThrough", "createdAt", "direction", "error", "factorCode", "factorCodeHash", "factorId", "factorName", "id", "methodologyHash", "status", "updatedAt", "userId") SELECT "builtin", "computedThrough", "createdAt", "direction", "error", "factorCode", "factorCodeHash", "factorId", "factorName", "id", "methodologyHash", "status", "updatedAt", "userId" FROM "FactorWeatherPin";
DROP TABLE "FactorWeatherPin";
ALTER TABLE "new_FactorWeatherPin" RENAME TO "FactorWeatherPin";
CREATE INDEX "FactorWeatherPin_status_updatedAt_idx" ON "FactorWeatherPin"("status", "updatedAt");
CREATE UNIQUE INDEX "FactorWeatherPin_userId_factorId_key" ON "FactorWeatherPin"("userId", "factorId");
CREATE TABLE "new_SignalRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "execDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
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
INSERT INTO "new_SignalRun" ("createdAt", "dataCutoff", "deploymentId", "error", "execDate", "factorInputs", "id", "modelCash", "modelEquity", "modelPositions", "notificationError", "notifiedAt", "signals", "status", "strategyId", "tradeDate", "updatedAt", "userId") SELECT "createdAt", "dataCutoff", "deploymentId", "error", "execDate", "factorInputs", "id", "modelCash", "modelEquity", "modelPositions", "notificationError", "notifiedAt", "signals", "status", "strategyId", "tradeDate", "updatedAt", "userId" FROM "SignalRun";
DROP TABLE "SignalRun";
ALTER TABLE "new_SignalRun" RENAME TO "SignalRun";
CREATE INDEX "SignalRun_userId_tradeDate_idx" ON "SignalRun"("userId", "tradeDate");
CREATE INDEX "SignalRun_strategyId_tradeDate_idx" ON "SignalRun"("strategyId", "tradeDate");
CREATE INDEX "SignalRun_status_idx" ON "SignalRun"("status");
CREATE UNIQUE INDEX "SignalRun_deploymentId_tradeDate_key" ON "SignalRun"("deploymentId", "tradeDate");
CREATE TABLE "new_StrategyDeployment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "strategyName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "factorDependencies" JSONB,
    "codeHash" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "deployedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StrategyDeployment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StrategyDeployment_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_StrategyDeployment" ("codeHash", "config", "createdAt", "deployedAt", "id", "locale", "status", "stoppedAt", "strategyId", "strategyName", "updatedAt", "userId") SELECT "codeHash", "config", "createdAt", "deployedAt", "id", "locale", "status", "stoppedAt", "strategyId", "strategyName", "updatedAt", "userId" FROM "StrategyDeployment";
DROP TABLE "StrategyDeployment";
ALTER TABLE "new_StrategyDeployment" RENAME TO "StrategyDeployment";
CREATE INDEX "StrategyDeployment_userId_status_idx" ON "StrategyDeployment"("userId", "status");
CREATE INDEX "StrategyDeployment_strategyId_status_idx" ON "StrategyDeployment"("strategyId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
