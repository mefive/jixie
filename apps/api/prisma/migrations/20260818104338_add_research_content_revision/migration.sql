-- AlterTable
ALTER TABLE "ResearchCellChangeProposal" ADD COLUMN "expectedDocumentContentRevision" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ResearchDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "runtimeVersion" TEXT NOT NULL DEFAULT 'research-py-v1',
    "contentRevision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchDocument_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ResearchDocument" ("conversationId", "createdAt", "id", "runtimeVersion", "updatedAt", "userId") SELECT "conversationId", "createdAt", "id", "runtimeVersion", "updatedAt", "userId" FROM "ResearchDocument";
DROP TABLE "ResearchDocument";
ALTER TABLE "new_ResearchDocument" RENAME TO "ResearchDocument";
CREATE UNIQUE INDEX "ResearchDocument_conversationId_key" ON "ResearchDocument"("conversationId");
CREATE INDEX "ResearchDocument_userId_updatedAt_idx" ON "ResearchDocument"("userId", "updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
