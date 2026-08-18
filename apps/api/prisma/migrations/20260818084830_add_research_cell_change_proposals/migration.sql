-- CreateTable
CREATE TABLE "ResearchCellChangeProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "sourceTurnId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "sourcePartIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "expectedDocumentUpdatedAt" DATETIME NOT NULL,
    "operations" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "conflict" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "ResearchCellChangeProposal_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellChangeProposal_sourceTurnId_fkey" FOREIGN KEY ("sourceTurnId") REFERENCES "AgentTurn" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellChangeProposal_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "AgentMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ResearchCellChangeProposal_documentId_status_createdAt_idx" ON "ResearchCellChangeProposal"("documentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchCellChangeProposal_sourceTurnId_idx" ON "ResearchCellChangeProposal"("sourceTurnId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchCellChangeProposal_sourceMessageId_sourcePartIndex_key" ON "ResearchCellChangeProposal"("sourceMessageId", "sourcePartIndex");
