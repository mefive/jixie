-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DatasetSyncPartition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dataset" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "gaps" JSONB,
    "error" TEXT,
    "lastRunId" TEXT,
    "lastAttemptAt" DATETIME,
    "checkedAt" DATETIME
);
INSERT INTO "new_DatasetSyncPartition" ("checkedAt", "dataset", "endDate", "error", "gaps", "id", "lastAttemptAt", "lastRunId", "scope", "startDate", "status") SELECT "checkedAt", "dataset", "endDate", "error", "gaps", "id", "lastAttemptAt", "lastRunId", "scope", "startDate", "status" FROM "DatasetSyncPartition";
DROP TABLE "DatasetSyncPartition";
ALTER TABLE "new_DatasetSyncPartition" RENAME TO "DatasetSyncPartition";
CREATE INDEX "DatasetSyncPartition_status_lastAttemptAt_idx" ON "DatasetSyncPartition"("status", "lastAttemptAt");
CREATE INDEX "DatasetSyncPartition_dataset_scope_startDate_idx" ON "DatasetSyncPartition"("dataset", "scope", "startDate");
CREATE UNIQUE INDEX "DatasetSyncPartition_dataset_scope_startDate_endDate_key" ON "DatasetSyncPartition"("dataset", "scope", "startDate", "endDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

