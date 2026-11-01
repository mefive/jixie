-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MarketDownloadList";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "EtfLatestSize";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "EtfSyncSlice";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MaintenanceRun";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "DataSyncRun";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "DatasetSyncState";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "DatasetSyncPartition";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trigger" TEXT NOT NULL,
    "targetDate" TEXT NOT NULL,
    "scopeSnapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "summary" JSONB,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "IngestionBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "api" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "rangeStart" TEXT,
    "rangeEnd" TEXT,
    "sourceStart" TEXT,
    "status" TEXT NOT NULL,
    "responseComplete" BOOLEAN NOT NULL DEFAULT false,
    "receivedCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "filteredCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "IngestionBatch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IngestionIssue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "batchId" TEXT,
    "category" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "businessKey" JSONB,
    "field" TEXT,
    "payload" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IngestionIssue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IngestionIssue_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "IngestionBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IngestionSelection" (
    "assetType" TEXT NOT NULL PRIMARY KEY,
    "codes" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "IngestionRun_startedAt_idx" ON "IngestionRun"("startedAt");

-- CreateIndex
CREATE INDEX "IngestionBatch_dataset_scope_period_startedAt_idx" ON "IngestionBatch"("dataset", "scope", "period", "startedAt");

-- CreateIndex
CREATE INDEX "IngestionBatch_status_idx" ON "IngestionBatch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionBatch_runId_dataset_scope_period_key" ON "IngestionBatch"("runId", "dataset", "scope", "period");

-- CreateIndex
CREATE INDEX "IngestionIssue_runId_createdAt_idx" ON "IngestionIssue"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "IngestionIssue_batchId_idx" ON "IngestionIssue"("batchId");

