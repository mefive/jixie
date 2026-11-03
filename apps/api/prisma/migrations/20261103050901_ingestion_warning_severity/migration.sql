-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_IngestionIssue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "batchId" TEXT,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'error',
    "reasonCode" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "businessKey" JSONB,
    "field" TEXT,
    "payload" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IngestionIssue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IngestionIssue_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "IngestionBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_IngestionIssue" ("batchId", "businessKey", "category", "createdAt", "field", "id", "message", "payload", "reasonCode", "runId") SELECT "batchId", "businessKey", "category", "createdAt", "field", "id", "message", "payload", "reasonCode", "runId" FROM "IngestionIssue";
DROP TABLE "IngestionIssue";
ALTER TABLE "new_IngestionIssue" RENAME TO "IngestionIssue";
CREATE INDEX "IngestionIssue_runId_createdAt_idx" ON "IngestionIssue"("runId", "createdAt");
CREATE INDEX "IngestionIssue_batchId_idx" ON "IngestionIssue"("batchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
