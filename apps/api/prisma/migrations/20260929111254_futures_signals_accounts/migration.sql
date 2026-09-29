-- CreateTable
CREATE TABLE "SignalResolution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deploymentId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "accountRevision" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignalResolution_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "StrategyDeployment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SignalResolution_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "SignalExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SignalFill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deploymentId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "replacesId" TEXT,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "tradeDate" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignalFill_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "StrategyDeployment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SignalFill_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "SignalExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SignalAccountMarketInput" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deploymentId" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "payload" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignalAccountMarketInput_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "StrategyDeployment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SignalAccountState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deploymentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "generation" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "accountRevision" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignalAccountState_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "StrategyDeployment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FutureMarketPublication" (
    "tradeDate" TEXT NOT NULL PRIMARY KEY,
    "payload" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SignalExecution" (
    "deploymentId" TEXT,
    "execDate" TEXT,
    "taskKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "intent" JSONB,
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "signalRunId" TEXT,
    "signalIndex" INTEGER,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "requestedShares" REAL,
    "refPrice" REAL NOT NULL,
    "refAmount" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "targetWeight" REAL,
    "simulatedStatus" TEXT NOT NULL DEFAULT 'pending',
    "simulatedShares" REAL,
    "simulatedPrice" REAL,
    "simulatedFee" REAL,
    "simulatedSlippage" REAL,
    "simulatedReason" TEXT,
    "actualStatus" TEXT NOT NULL DEFAULT 'pending',
    "actualShares" REAL,
    "actualPrice" REAL,
    "actualFee" REAL,
    "actualReason" TEXT,
    "actualNote" TEXT,
    "actualRecordedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SignalExecution_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "StrategyDeployment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SignalExecution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SignalExecution_signalRunId_fkey" FOREIGN KEY ("signalRunId") REFERENCES "SignalRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SignalExecution" ("action", "actualFee", "actualNote", "actualPrice", "actualReason", "actualRecordedAt", "actualShares", "actualStatus", "assetType", "code", "createdAt", "id", "name", "refAmount", "refPrice", "requestedShares", "signalIndex", "signalRunId", "simulatedFee", "simulatedPrice", "simulatedReason", "simulatedShares", "simulatedSlippage", "simulatedStatus", "source", "targetWeight", "updatedAt", "userId") SELECT "action", "actualFee", "actualNote", "actualPrice", "actualReason", "actualRecordedAt", "actualShares", "actualStatus", "assetType", "code", "createdAt", "id", "name", "refAmount", "refPrice", "requestedShares", "signalIndex", "signalRunId", "simulatedFee", "simulatedPrice", "simulatedReason", "simulatedShares", "simulatedSlippage", "simulatedStatus", "source", "targetWeight", "updatedAt", "userId" FROM "SignalExecution";
DROP TABLE "SignalExecution";
ALTER TABLE "new_SignalExecution" RENAME TO "SignalExecution";
CREATE UNIQUE INDEX "SignalExecution_taskKey_key" ON "SignalExecution"("taskKey");
CREATE INDEX "SignalExecution_userId_actualStatus_idx" ON "SignalExecution"("userId", "actualStatus");
CREATE INDEX "SignalExecution_code_createdAt_idx" ON "SignalExecution"("code", "createdAt");
CREATE UNIQUE INDEX "SignalExecution_signalRunId_signalIndex_key" ON "SignalExecution"("signalRunId", "signalIndex");
CREATE TABLE "new_SignalRun" (
    "accountingInitialized" BOOLEAN NOT NULL DEFAULT false,
    "resultVersion" INTEGER NOT NULL DEFAULT 1,
    "modelAccounts" JSONB,
    "intentSnapshot" JSONB,
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
CREATE TABLE "new_StrategyDeployment" (
    "simulationStatus" TEXT NOT NULL DEFAULT 'pending',
    "simulationError" TEXT,
    "actualAccountStatus" TEXT NOT NULL DEFAULT 'pending',
    "actualAccountError" TEXT,
    "accountingVersion" INTEGER NOT NULL DEFAULT 1,
    "accountInputRevision" INTEGER NOT NULL DEFAULT 0,
    "simulationGeneration" TEXT,
    "actualGeneration" TEXT,
    "replayStatus" TEXT NOT NULL DEFAULT 'pending',
    "replayError" TEXT,
    "dirtyFromDate" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "backtestReportId" TEXT,
    "activeReportId" TEXT,
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
    CONSTRAINT "StrategyDeployment_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "StrategyDeployment_backtestReportId_fkey" FOREIGN KEY ("backtestReportId") REFERENCES "BacktestReport" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);
INSERT INTO "new_StrategyDeployment" ("activeReportId", "backtestReportId", "codeHash", "config", "createdAt", "deployedAt", "factorDependencies", "id", "locale", "status", "stoppedAt", "strategyId", "strategyName", "updatedAt", "userId") SELECT "activeReportId", "backtestReportId", "codeHash", "config", "createdAt", "deployedAt", "factorDependencies", "id", "locale", "status", "stoppedAt", "strategyId", "strategyName", "updatedAt", "userId" FROM "StrategyDeployment";
DROP TABLE "StrategyDeployment";
ALTER TABLE "new_StrategyDeployment" RENAME TO "StrategyDeployment";
CREATE UNIQUE INDEX "StrategyDeployment_activeReportId_key" ON "StrategyDeployment"("activeReportId");
CREATE INDEX "StrategyDeployment_userId_status_idx" ON "StrategyDeployment"("userId", "status");
CREATE INDEX "StrategyDeployment_strategyId_status_idx" ON "StrategyDeployment"("strategyId", "status");
CREATE INDEX "StrategyDeployment_backtestReportId_idx" ON "StrategyDeployment"("backtestReportId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "SignalResolution_requestKey_key" ON "SignalResolution"("requestKey");

-- CreateIndex
CREATE INDEX "SignalResolution_deploymentId_kind_idx" ON "SignalResolution"("deploymentId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SignalFill_requestKey_key" ON "SignalFill"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "SignalFill_replacesId_key" ON "SignalFill"("replacesId");

-- CreateIndex
CREATE INDEX "SignalFill_deploymentId_tradeDate_idx" ON "SignalFill"("deploymentId", "tradeDate");

-- CreateIndex
CREATE UNIQUE INDEX "SignalAccountMarketInput_deploymentId_tradeDate_revision_key" ON "SignalAccountMarketInput"("deploymentId", "tradeDate", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "SignalAccountState_deploymentId_kind_generation_tradeDate_key" ON "SignalAccountState"("deploymentId", "kind", "generation", "tradeDate");
