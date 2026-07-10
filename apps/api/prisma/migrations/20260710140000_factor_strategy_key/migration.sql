-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Factor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT,
    "keyCandidate" TEXT,
    "name" TEXT NOT NULL,
    "descriptionZh" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL,
    "messages" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Factor" ("code", "createdAt", "id", "messages", "name", "updatedAt", "userId") SELECT "code", "createdAt", "id", "messages", "name", "updatedAt", "userId" FROM "Factor";
DROP TABLE "Factor";
ALTER TABLE "new_Factor" RENAME TO "Factor";
CREATE INDEX "Factor_userId_updatedAt_idx" ON "Factor"("userId", "updatedAt");
CREATE UNIQUE INDEX "Factor_userId_key_key" ON "Factor"("userId", "key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
