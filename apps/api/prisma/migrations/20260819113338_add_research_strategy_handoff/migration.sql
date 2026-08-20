-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Strategy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "lastResult" JSONB,
    "messages" JSONB,
    "sourceResearchExecutionId" TEXT,
    "researchHandoff" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Strategy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Strategy_sourceResearchExecutionId_fkey" FOREIGN KEY ("sourceResearchExecutionId") REFERENCES "ResearchExecution" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Strategy" ("config", "createdAt", "id", "lastResult", "messages", "name", "updatedAt", "userId", "visibility") SELECT "config", "createdAt", "id", "lastResult", "messages", "name", "updatedAt", "userId", "visibility" FROM "Strategy";
DROP TABLE "Strategy";
ALTER TABLE "new_Strategy" RENAME TO "Strategy";
CREATE UNIQUE INDEX "Strategy_sourceResearchExecutionId_key" ON "Strategy"("sourceResearchExecutionId");
CREATE INDEX "Strategy_userId_updatedAt_idx" ON "Strategy"("userId", "updatedAt");
CREATE INDEX "Strategy_visibility_updatedAt_idx" ON "Strategy"("visibility", "updatedAt");
CREATE UNIQUE INDEX "Strategy_userId_name_key" ON "Strategy"("userId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
