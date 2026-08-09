-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FactorComposite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvedReportId" TEXT,
    "codeHash" TEXT,
    "publishedAt" DATETIME,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FactorComposite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FactorComposite" ("createdAt", "definition", "id", "name", "updatedAt", "userId") SELECT "createdAt", "definition", "id", "name", "updatedAt", "userId" FROM "FactorComposite";
DROP TABLE "FactorComposite";
ALTER TABLE "new_FactorComposite" RENAME TO "FactorComposite";
CREATE UNIQUE INDEX "FactorComposite_approvedReportId_key" ON "FactorComposite"("approvedReportId");
CREATE INDEX "FactorComposite_userId_updatedAt_idx" ON "FactorComposite"("userId", "updatedAt");
CREATE UNIQUE INDEX "FactorComposite_userId_key_key" ON "FactorComposite"("userId", "key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
