-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ResearchCell" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "config" JSONB,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "definitions" JSONB NOT NULL,
    "references" JSONB NOT NULL,
    "dependencyIssues" JSONB NOT NULL DEFAULT [],
    "output" JSONB,
    "lastExecutedRevision" INTEGER,
    "lastExecutedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchCell_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ResearchCell" ("config", "createdAt", "definitions", "documentId", "id", "kind", "lastExecutedAt", "lastExecutedRevision", "output", "position", "references", "revision", "source", "status", "updatedAt") SELECT "config", "createdAt", "definitions", "documentId", "id", "kind", "lastExecutedAt", "lastExecutedRevision", "output", "position", "references", "revision", "source", "status", "updatedAt" FROM "ResearchCell";
DROP TABLE "ResearchCell";
ALTER TABLE "new_ResearchCell" RENAME TO "ResearchCell";
CREATE INDEX "ResearchCell_documentId_updatedAt_idx" ON "ResearchCell"("documentId", "updatedAt");
CREATE UNIQUE INDEX "ResearchCell_documentId_position_key" ON "ResearchCell"("documentId", "position");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
