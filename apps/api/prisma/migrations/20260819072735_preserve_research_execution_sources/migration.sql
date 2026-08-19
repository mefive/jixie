-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ResearchCellExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "cellId" TEXT,
    "sourceCellId" TEXT,
    "sourcePosition" INTEGER,
    "sourceKind" TEXT,
    "revision" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "definitions" JSONB NOT NULL,
    "references" JSONB NOT NULL,
    "environmentFingerprint" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "cellChangeAttemptId" TEXT,
    "researchExecutionId" TEXT,
    CONSTRAINT "ResearchCellExecution_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellExecution_cellId_fkey" FOREIGN KEY ("cellId") REFERENCES "ResearchCell" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellExecution_cellChangeAttemptId_fkey" FOREIGN KEY ("cellChangeAttemptId") REFERENCES "ResearchCellChangeAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellExecution_researchExecutionId_fkey" FOREIGN KEY ("researchExecutionId") REFERENCES "ResearchExecution" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ResearchCellExecution" ("cellChangeAttemptId", "cellId", "definitions", "documentId", "environmentFingerprint", "error", "finishedAt", "id", "output", "references", "researchExecutionId", "revision", "source", "startedAt", "status") SELECT "cellChangeAttemptId", "cellId", "definitions", "documentId", "environmentFingerprint", "error", "finishedAt", "id", "output", "references", "researchExecutionId", "revision", "source", "startedAt", "status" FROM "ResearchCellExecution";
DROP TABLE "ResearchCellExecution";
ALTER TABLE "new_ResearchCellExecution" RENAME TO "ResearchCellExecution";
CREATE INDEX "ResearchCellExecution_documentId_startedAt_idx" ON "ResearchCellExecution"("documentId", "startedAt");
CREATE INDEX "ResearchCellExecution_cellId_startedAt_idx" ON "ResearchCellExecution"("cellId", "startedAt");
CREATE INDEX "ResearchCellExecution_sourceCellId_startedAt_idx" ON "ResearchCellExecution"("sourceCellId", "startedAt");
CREATE INDEX "ResearchCellExecution_cellChangeAttemptId_startedAt_idx" ON "ResearchCellExecution"("cellChangeAttemptId", "startedAt");
CREATE INDEX "ResearchCellExecution_researchExecutionId_startedAt_idx" ON "ResearchCellExecution"("researchExecutionId", "startedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
