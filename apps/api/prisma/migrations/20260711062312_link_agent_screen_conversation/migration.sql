-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "title" TEXT,
    "strategyId" TEXT,
    "factorId" TEXT,
    "screenConversationId" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentConversation_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentConversation_factorId_fkey" FOREIGN KEY ("factorId") REFERENCES "Factor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentConversation_screenConversationId_fkey" FOREIGN KEY ("screenConversationId") REFERENCES "ScreenConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AgentConversation" ("archivedAt", "createdAt", "factorId", "id", "strategyId", "surface", "title", "updatedAt", "userId") SELECT "archivedAt", "createdAt", "factorId", "id", "strategyId", "surface", "title", "updatedAt", "userId" FROM "AgentConversation";
DROP TABLE "AgentConversation";
ALTER TABLE "new_AgentConversation" RENAME TO "AgentConversation";
CREATE INDEX "AgentConversation_userId_updatedAt_idx" ON "AgentConversation"("userId", "updatedAt");
CREATE INDEX "AgentConversation_userId_surface_updatedAt_idx" ON "AgentConversation"("userId", "surface", "updatedAt");
CREATE INDEX "AgentConversation_strategyId_idx" ON "AgentConversation"("strategyId");
CREATE INDEX "AgentConversation_factorId_idx" ON "AgentConversation"("factorId");
CREATE INDEX "AgentConversation_screenConversationId_idx" ON "AgentConversation"("screenConversationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
