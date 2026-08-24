-- CreateTable
CREATE TABLE "ResearchClarification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "sourceTurnId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "sourcePartIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "answer" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" DATETIME,
    CONSTRAINT "ResearchClarification_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchClarification_sourceTurnId_fkey" FOREIGN KEY ("sourceTurnId") REFERENCES "AgentTurn" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchClarification_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "AgentMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ResearchClarification_documentId_status_createdAt_idx" ON "ResearchClarification"("documentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchClarification_sourceTurnId_idx" ON "ResearchClarification"("sourceTurnId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchClarification_sourceMessageId_sourcePartIndex_key" ON "ResearchClarification"("sourceMessageId", "sourcePartIndex");
