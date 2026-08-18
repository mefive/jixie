-- AlterTable
ALTER TABLE "ResearchCellChangeProposal" ADD COLUMN "appliedDocumentContentRevision" INTEGER;

-- CreateTable
CREATE TABLE "ResearchCellChangeAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "contentRevision" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "rootCellIds" JSONB NOT NULL,
    "plannedCellIds" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "explanationTurnId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "ResearchCellChangeAttempt_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellChangeAttempt_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ResearchCellChangeProposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    CONSTRAINT "ResearchCellExecution_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellExecution_cellId_fkey" FOREIGN KEY ("cellId") REFERENCES "ResearchCell" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellExecution_cellChangeAttemptId_fkey" FOREIGN KEY ("cellChangeAttemptId") REFERENCES "ResearchCellChangeAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ResearchCellExecution" ("cellId", "definitions", "documentId", "environmentFingerprint", "error", "finishedAt", "id", "output", "references", "revision", "source", "startedAt", "status") SELECT "cellId", "definitions", "documentId", "environmentFingerprint", "error", "finishedAt", "id", "output", "references", "revision", "source", "startedAt", "status" FROM "ResearchCellExecution";
DROP TABLE "ResearchCellExecution";
ALTER TABLE "new_ResearchCellExecution" RENAME TO "ResearchCellExecution";
CREATE INDEX "ResearchCellExecution_documentId_startedAt_idx" ON "ResearchCellExecution"("documentId", "startedAt");
CREATE INDEX "ResearchCellExecution_cellId_startedAt_idx" ON "ResearchCellExecution"("cellId", "startedAt");
CREATE INDEX "ResearchCellExecution_cellChangeAttemptId_startedAt_idx" ON "ResearchCellExecution"("cellChangeAttemptId", "startedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ResearchCellChangeAttempt_documentId_startedAt_idx" ON "ResearchCellChangeAttempt"("documentId", "startedAt");

-- CreateIndex
CREATE INDEX "ResearchCellChangeAttempt_proposalId_startedAt_idx" ON "ResearchCellChangeAttempt"("proposalId", "startedAt");
