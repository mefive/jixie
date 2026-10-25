-- DropIndex
DROP INDEX "StrategyDeployment_activeReportId_key";

-- DropIndex
DROP INDEX "StrategyDeployment_userId_status_idx";

-- DropIndex
DROP INDEX "StrategyDeployment_strategyId_status_idx";

-- DropIndex
DROP INDEX "StrategyDeployment_backtestReportId_idx";

-- DropIndex
DROP INDEX "SignalRun_userId_tradeDate_idx";

-- DropIndex
DROP INDEX "SignalRun_strategyId_tradeDate_idx";

-- DropIndex
DROP INDEX "SignalRun_status_idx";

-- DropIndex
DROP INDEX "SignalRun_deploymentId_tradeDate_key";

-- DropIndex
DROP INDEX "SignalExecution_taskKey_key";

-- DropIndex
DROP INDEX "SignalExecution_userId_actualStatus_idx";

-- DropIndex
DROP INDEX "SignalExecution_code_createdAt_idx";

-- DropIndex
DROP INDEX "SignalExecution_signalRunId_signalIndex_key";

-- DropIndex
DROP INDEX "StrategyAccountSnapshot_userId_kind_tradeDate_idx";

-- DropIndex
DROP INDEX "StrategyAccountSnapshot_deploymentId_kind_isBaseline_idx";

-- DropIndex
DROP INDEX "StrategyAccountSnapshot_deploymentId_kind_tradeDate_key";

-- DropIndex
DROP INDEX "SignalResolution_requestKey_key";

-- DropIndex
DROP INDEX "SignalResolution_deploymentId_kind_idx";

-- DropIndex
DROP INDEX "SignalFill_requestKey_key";

-- DropIndex
DROP INDEX "SignalFill_replacesId_key";

-- DropIndex
DROP INDEX "SignalFill_deploymentId_tradeDate_idx";

-- DropIndex
DROP INDEX "SignalAccountMarketInput_deploymentId_tradeDate_revision_key";

-- DropIndex
DROP INDEX "SignalAccountState_deploymentId_kind_generation_tradeDate_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "StrategyDeployment";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SignalRun";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SignalExecution";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "StrategyAccountSnapshot";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SignalResolution";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SignalFill";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SignalAccountMarketInput";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SignalAccountState";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB,
    "error" TEXT,
    "logs" TEXT,
    "factorReportId" TEXT,
    "backtestReportId" TEXT,
    "strategyScanReportId" TEXT,
    "researchExecutionId" TEXT,
    "researchCuratorRunId" TEXT,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_factorReportId_fkey" FOREIGN KEY ("factorReportId") REFERENCES "FactorReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_backtestReportId_fkey" FOREIGN KEY ("backtestReportId") REFERENCES "BacktestReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_strategyScanReportId_fkey" FOREIGN KEY ("strategyScanReportId") REFERENCES "StrategyScanReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_researchExecutionId_fkey" FOREIGN KEY ("researchExecutionId") REFERENCES "ResearchExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_researchCuratorRunId_fkey" FOREIGN KEY ("researchCuratorRunId") REFERENCES "ResearchCuratorRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("backtestReportId", "createdAt", "error", "factorReportId", "finishedAt", "id", "key", "kind", "logs", "payload", "queuedAt", "researchCuratorRunId", "researchExecutionId", "startedAt", "status", "strategyScanReportId", "updatedAt", "userId") SELECT "backtestReportId", "createdAt", "error", "factorReportId", "finishedAt", "id", "key", "kind", "logs", "payload", "queuedAt", "researchCuratorRunId", "researchExecutionId", "startedAt", "status", "strategyScanReportId", "updatedAt", "userId" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE UNIQUE INDEX "Job_factorReportId_key" ON "Job"("factorReportId");
CREATE UNIQUE INDEX "Job_backtestReportId_key" ON "Job"("backtestReportId");
CREATE UNIQUE INDEX "Job_strategyScanReportId_key" ON "Job"("strategyScanReportId");
CREATE UNIQUE INDEX "Job_researchExecutionId_key" ON "Job"("researchExecutionId");
CREATE UNIQUE INDEX "Job_researchCuratorRunId_key" ON "Job"("researchCuratorRunId");
CREATE INDEX "Job_userId_kind_key_status_idx" ON "Job"("userId", "kind", "key", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
