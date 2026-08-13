/*
  Warnings:

  - You are about to drop the `SavedScreen` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ScreenConversation` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `screenConversationId` on the `AgentConversation` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "SavedScreen_userId_name_key";

-- DropIndex
DROP INDEX "SavedScreen_userId_updatedAt_idx";

-- DropIndex
DROP INDEX "ScreenConversation_userId_updatedAt_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SavedScreen";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ScreenConversation";
PRAGMA foreign_keys=on;

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
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentConversation_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentConversation_factorId_fkey" FOREIGN KEY ("factorId") REFERENCES "Factor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AgentConversation" ("archivedAt", "createdAt", "factorId", "id", "strategyId", "surface", "title", "updatedAt", "userId") SELECT "archivedAt", "createdAt", "factorId", "id", "strategyId", "surface", "title", "updatedAt", "userId" FROM "AgentConversation";
DROP TABLE "AgentConversation";
ALTER TABLE "new_AgentConversation" RENAME TO "AgentConversation";
CREATE INDEX "AgentConversation_userId_updatedAt_idx" ON "AgentConversation"("userId", "updatedAt");
CREATE INDEX "AgentConversation_userId_surface_updatedAt_idx" ON "AgentConversation"("userId", "surface", "updatedAt");
CREATE INDEX "AgentConversation_strategyId_idx" ON "AgentConversation"("strategyId");
CREATE INDEX "AgentConversation_factorId_idx" ON "AgentConversation"("factorId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
