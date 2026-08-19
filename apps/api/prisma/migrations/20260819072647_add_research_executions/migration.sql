-- CreateTable
CREATE TABLE "ResearchExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "contentRevision" INTEGER NOT NULL,
    "runtimeVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "sourceHash" TEXT NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "dagSnapshot" JSONB NOT NULL,
    "executedCellIds" JSONB NOT NULL,
    "environmentFingerprint" TEXT,
    "error" TEXT,
    "displayName" TEXT,
    "tags" JSONB,
    "userNote" TEXT,
    "promotedAt" DATETIME,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "ResearchExecution_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ResearchCellExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "cellId" TEXT NOT NULL,
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
    CONSTRAINT "ResearchCellExecution_cellId_fkey" FOREIGN KEY ("cellId") REFERENCES "ResearchCell" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellExecution_cellChangeAttemptId_fkey" FOREIGN KEY ("cellChangeAttemptId") REFERENCES "ResearchCellChangeAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellExecution_researchExecutionId_fkey" FOREIGN KEY ("researchExecutionId") REFERENCES "ResearchExecution" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ResearchCellExecution" ("cellChangeAttemptId", "cellId", "definitions", "documentId", "environmentFingerprint", "error", "finishedAt", "id", "output", "references", "revision", "source", "startedAt", "status") SELECT "cellChangeAttemptId", "cellId", "definitions", "documentId", "environmentFingerprint", "error", "finishedAt", "id", "output", "references", "revision", "source", "startedAt", "status" FROM "ResearchCellExecution";
DROP TABLE "ResearchCellExecution";
ALTER TABLE "new_ResearchCellExecution" RENAME TO "ResearchCellExecution";
CREATE INDEX "ResearchCellExecution_documentId_startedAt_idx" ON "ResearchCellExecution"("documentId", "startedAt");
CREATE INDEX "ResearchCellExecution_cellId_startedAt_idx" ON "ResearchCellExecution"("cellId", "startedAt");
CREATE INDEX "ResearchCellExecution_cellChangeAttemptId_startedAt_idx" ON "ResearchCellExecution"("cellChangeAttemptId", "startedAt");
CREATE INDEX "ResearchCellExecution_researchExecutionId_startedAt_idx" ON "ResearchCellExecution"("researchExecutionId", "startedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ResearchExecution_documentId_startedAt_idx" ON "ResearchExecution"("documentId", "startedAt");

-- CreateIndex
CREATE INDEX "ResearchExecution_documentId_promotedAt_idx" ON "ResearchExecution"("documentId", "promotedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchExecution_documentId_sequence_key" ON "ResearchExecution"("documentId", "sequence");
