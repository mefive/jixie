-- CreateTable
CREATE TABLE "StrategyDeployment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "strategyName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "codeHash" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "deployedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StrategyDeployment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StrategyDeployment_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SignalRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "execDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dataCutoff" TEXT,
    "modelEquity" REAL,
    "modelCash" REAL,
    "signals" JSONB,
    "error" TEXT,
    "notifiedAt" DATETIME,
    "notificationError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SignalRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SignalRun_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "StrategyDeployment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "logs" TEXT,
    "factorReportId" TEXT,
    "strategyScanReportId" TEXT,
    "signalRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_factorReportId_fkey" FOREIGN KEY ("factorReportId") REFERENCES "FactorReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_strategyScanReportId_fkey" FOREIGN KEY ("strategyScanReportId") REFERENCES "StrategyScanReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_signalRunId_fkey" FOREIGN KEY ("signalRunId") REFERENCES "SignalRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("createdAt", "error", "factorReportId", "id", "key", "kind", "logs", "status", "strategyScanReportId", "updatedAt", "userId") SELECT "createdAt", "error", "factorReportId", "id", "key", "kind", "logs", "status", "strategyScanReportId", "updatedAt", "userId" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE UNIQUE INDEX "Job_factorReportId_key" ON "Job"("factorReportId");
CREATE UNIQUE INDEX "Job_strategyScanReportId_key" ON "Job"("strategyScanReportId");
CREATE INDEX "Job_userId_kind_key_status_idx" ON "Job"("userId", "kind", "key", "status");
CREATE INDEX "Job_signalRunId_createdAt_idx" ON "Job"("signalRunId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "StrategyDeployment_userId_status_idx" ON "StrategyDeployment"("userId", "status");

-- CreateIndex
CREATE INDEX "StrategyDeployment_strategyId_status_idx" ON "StrategyDeployment"("strategyId", "status");

-- CreateIndex
CREATE INDEX "SignalRun_userId_tradeDate_idx" ON "SignalRun"("userId", "tradeDate");

-- CreateIndex
CREATE INDEX "SignalRun_strategyId_tradeDate_idx" ON "SignalRun"("strategyId", "tradeDate");

-- CreateIndex
CREATE INDEX "SignalRun_status_idx" ON "SignalRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SignalRun_deploymentId_tradeDate_key" ON "SignalRun"("deploymentId", "tradeDate");
