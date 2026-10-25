-- DropIndex
DROP INDEX "ResearchCuratorRun_userId_createdAt_idx";

-- DropIndex
DROP INDEX "ResearchCuratorRun_userId_status_createdAt_idx";

-- DropIndex
DROP INDEX "ResearchCuratorFinding_userId_disposition_createdAt_idx";

-- DropIndex
DROP INDEX "ResearchCuratorFinding_runId_createdAt_idx";

-- DropIndex
DROP INDEX "ResearchCuratorFinding_userId_fingerprint_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ResearchCuratorRun";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ResearchCuratorFinding";
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
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_factorReportId_fkey" FOREIGN KEY ("factorReportId") REFERENCES "FactorReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_backtestReportId_fkey" FOREIGN KEY ("backtestReportId") REFERENCES "BacktestReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_strategyScanReportId_fkey" FOREIGN KEY ("strategyScanReportId") REFERENCES "StrategyScanReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_researchExecutionId_fkey" FOREIGN KEY ("researchExecutionId") REFERENCES "ResearchExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("backtestReportId", "createdAt", "error", "factorReportId", "finishedAt", "id", "key", "kind", "logs", "payload", "queuedAt", "researchExecutionId", "startedAt", "status", "strategyScanReportId", "updatedAt", "userId") SELECT "backtestReportId", "createdAt", "error", "factorReportId", "finishedAt", "id", "key", "kind", "logs", "payload", "queuedAt", "researchExecutionId", "startedAt", "status", "strategyScanReportId", "updatedAt", "userId" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE UNIQUE INDEX "Job_factorReportId_key" ON "Job"("factorReportId");
CREATE UNIQUE INDEX "Job_backtestReportId_key" ON "Job"("backtestReportId");
CREATE UNIQUE INDEX "Job_strategyScanReportId_key" ON "Job"("strategyScanReportId");
CREATE UNIQUE INDEX "Job_researchExecutionId_key" ON "Job"("researchExecutionId");
CREATE INDEX "Job_userId_kind_key_status_idx" ON "Job"("userId", "kind", "key", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
