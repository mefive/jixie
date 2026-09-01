-- CreateTable
CREATE TABLE "BacktestReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "strategyName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
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

-- Preserve the latest result already cached on each Strategy as one immutable legacy report.
INSERT INTO "BacktestReport" (
    "id", "userId", "strategyId", "strategyName", "status", "config", "payload", "createdAt", "computedAt"
)
SELECT
    'legacy:' || "id", "userId", "id", "name", 'done', "config", "lastResult", "updatedAt", "updatedAt"
FROM "Strategy"
WHERE "lastResult" IS NOT NULL;

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
    "signalRunId" TEXT,
    "researchCuratorRunId" TEXT,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_factorReportId_fkey" FOREIGN KEY ("factorReportId") REFERENCES "FactorReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_backtestReportId_fkey" FOREIGN KEY ("backtestReportId") REFERENCES "BacktestReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_strategyScanReportId_fkey" FOREIGN KEY ("strategyScanReportId") REFERENCES "StrategyScanReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_signalRunId_fkey" FOREIGN KEY ("signalRunId") REFERENCES "SignalRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_researchCuratorRunId_fkey" FOREIGN KEY ("researchCuratorRunId") REFERENCES "ResearchCuratorRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Job" (
    "createdAt", "error", "factorReportId", "finishedAt", "id", "key", "kind", "logs", "payload", "queuedAt", "researchCuratorRunId", "signalRunId", "startedAt", "status", "strategyScanReportId", "updatedAt", "userId"
) SELECT
    "createdAt", "error", "factorReportId", "finishedAt", "id", "key", "kind", "logs", "payload", "queuedAt", "researchCuratorRunId", "signalRunId", "startedAt", "status", "strategyScanReportId", "updatedAt", "userId"
FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE UNIQUE INDEX "Job_factorReportId_key" ON "Job"("factorReportId");
CREATE UNIQUE INDEX "Job_backtestReportId_key" ON "Job"("backtestReportId");
CREATE UNIQUE INDEX "Job_strategyScanReportId_key" ON "Job"("strategyScanReportId");
CREATE UNIQUE INDEX "Job_researchCuratorRunId_key" ON "Job"("researchCuratorRunId");
CREATE INDEX "Job_userId_kind_key_status_idx" ON "Job"("userId", "kind", "key", "status");
CREATE INDEX "Job_signalRunId_createdAt_idx" ON "Job"("signalRunId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "BacktestReport_userId_strategyId_createdAt_idx" ON "BacktestReport"("userId", "strategyId", "createdAt");

-- CreateIndex
CREATE INDEX "BacktestReport_userId_status_createdAt_idx" ON "BacktestReport"("userId", "status", "createdAt");
