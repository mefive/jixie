-- CreateTable
CREATE TABLE "AgentCodeChangeProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sourceTurnId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "baseIdentity" TEXT NOT NULL,
    "beforeCode" TEXT NOT NULL,
    "afterCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    CONSTRAINT "AgentCodeChangeProposal_sourceTurnId_fkey" FOREIGN KEY ("sourceTurnId") REFERENCES "AgentTurn" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentCodeChangeProposal_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "AgentMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AgentCodeChangeProposal_userId_surface_entityId_createdAt_idx" ON "AgentCodeChangeProposal"("userId", "surface", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCodeChangeProposal_sourceTurnId_key" ON "AgentCodeChangeProposal"("sourceTurnId");

