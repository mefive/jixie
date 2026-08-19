-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ResearchCellChangeProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "sourceTurnId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "sourcePartIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "expectedDocumentUpdatedAt" DATETIME NOT NULL,
    "expectedDocumentContentRevision" INTEGER,
    "appliedDocumentContentRevision" INTEGER,
    "reviewSessionId" TEXT,
    "reviewSequence" INTEGER,
    "reviewStatus" TEXT,
    "reviewIsLatest" BOOLEAN NOT NULL DEFAULT false,
    "reviewResolvedAt" DATETIME,
    "operations" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "conflict" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "ResearchCellChangeProposal_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellChangeProposal_sourceTurnId_fkey" FOREIGN KEY ("sourceTurnId") REFERENCES "AgentTurn" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellChangeProposal_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "AgentMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ResearchCellChangeProposal" ("appliedDocumentContentRevision", "conflict", "createdAt", "documentId", "expectedDocumentContentRevision", "expectedDocumentUpdatedAt", "id", "operations", "resolvedAt", "sourceMessageId", "sourcePartIndex", "sourceTurnId", "status", "summary", "title") SELECT "appliedDocumentContentRevision", "conflict", "createdAt", "documentId", "expectedDocumentContentRevision", "expectedDocumentUpdatedAt", "id", "operations", "resolvedAt", "sourceMessageId", "sourcePartIndex", "sourceTurnId", "status", "summary", "title" FROM "ResearchCellChangeProposal";
DROP TABLE "ResearchCellChangeProposal";
ALTER TABLE "new_ResearchCellChangeProposal" RENAME TO "ResearchCellChangeProposal";
CREATE INDEX "ResearchCellChangeProposal_documentId_status_createdAt_idx" ON "ResearchCellChangeProposal"("documentId", "status", "createdAt");
CREATE INDEX "ResearchCellChangeProposal_documentId_reviewStatus_createdAt_idx" ON "ResearchCellChangeProposal"("documentId", "reviewStatus", "createdAt");
CREATE INDEX "ResearchCellChangeProposal_reviewSessionId_reviewSequence_idx" ON "ResearchCellChangeProposal"("reviewSessionId", "reviewSequence");
CREATE INDEX "ResearchCellChangeProposal_sourceTurnId_idx" ON "ResearchCellChangeProposal"("sourceTurnId");
CREATE UNIQUE INDEX "ResearchCellChangeProposal_sourceMessageId_sourcePartIndex_key" ON "ResearchCellChangeProposal"("sourceMessageId", "sourcePartIndex");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
