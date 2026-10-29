-- DropIndex
DROP INDEX "MaintenanceCheckpoint_runId_stage_idx";

-- DropIndex
DROP INDEX "MarketCalculationState_status_date_idx";

-- DropIndex
DROP INDEX "MarketRecordEvidence_dataset_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MaintenanceCheckpoint";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MaintenanceState";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MarketCalculationState";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MarketRecordEvidence";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Dividend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tsCode" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "annDate" TEXT,
    "exDate" TEXT,
    "divProc" TEXT,
    "cashDiv" REAL,
    "cashDivTax" REAL,
    "observedAt" DATETIME,
    "availabilityQuality" TEXT NOT NULL DEFAULT 'unknown'
);
INSERT INTO "new_Dividend" ("annDate", "cashDiv", "cashDivTax", "divProc", "endDate", "exDate", "id", "tsCode") SELECT "annDate", "cashDiv", "cashDivTax", "divProc", "endDate", "exDate", "id", "tsCode" FROM "Dividend";
DROP TABLE "Dividend";
ALTER TABLE "new_Dividend" RENAME TO "Dividend";
CREATE INDEX "Dividend_tsCode_idx" ON "Dividend"("tsCode");
CREATE TABLE "new_DatasetSyncState" (
    "dataset" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "maxObservedDate" TEXT,
    "verifiedThrough" TEXT,
    "lastCheckedAt" DATETIME,
    "lastBackfillAt" DATETIME,

    PRIMARY KEY ("dataset", "scope")
);
INSERT INTO "new_DatasetSyncState" ("dataset", "lastBackfillAt", "lastCheckedAt", "maxObservedDate", "scope", "verifiedThrough") SELECT "dataset", "lastBackfillAt", "lastCheckedAt", "maxObservedDate", "scope", "verifiedThrough" FROM "DatasetSyncState";
DROP TABLE "DatasetSyncState";
ALTER TABLE "new_DatasetSyncState" RENAME TO "DatasetSyncState";
CREATE TABLE "new_DatasetSyncPartition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dataset" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "gaps" JSONB,
    "error" TEXT,
    "lastRunId" TEXT,
    "lastAttemptAt" DATETIME,
    "checkedAt" DATETIME
);
INSERT INTO "new_DatasetSyncPartition" ("checkedAt", "dataset", "endDate", "error", "gaps", "id", "lastAttemptAt", "lastRunId", "policyVersion", "scope", "startDate", "status") SELECT "checkedAt", "dataset", "endDate", "error", "gaps", "id", "lastAttemptAt", "lastRunId", "policyVersion", "scope", "startDate", "status" FROM "DatasetSyncPartition";
DROP TABLE "DatasetSyncPartition";
ALTER TABLE "new_DatasetSyncPartition" RENAME TO "DatasetSyncPartition";
CREATE INDEX "DatasetSyncPartition_status_lastAttemptAt_idx" ON "DatasetSyncPartition"("status", "lastAttemptAt");
CREATE INDEX "DatasetSyncPartition_dataset_scope_startDate_idx" ON "DatasetSyncPartition"("dataset", "scope", "startDate");
CREATE UNIQUE INDEX "DatasetSyncPartition_dataset_scope_startDate_endDate_key" ON "DatasetSyncPartition"("dataset", "scope", "startDate", "endDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

