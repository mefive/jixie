-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Factor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "analysisKind" TEXT NOT NULL DEFAULT 'cross_sectional',
    "descriptionZh" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL,
    "messages" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "approvedReportId" TEXT,
    "sourceResearchExecutionId" TEXT,
    "researchHandoff" JSONB,
    "codeHash" TEXT,
    "publishedAt" DATETIME,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Factor_approvedReportId_fkey" FOREIGN KEY ("approvedReportId") REFERENCES "FactorReport" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Factor_sourceResearchExecutionId_fkey" FOREIGN KEY ("sourceResearchExecutionId") REFERENCES "ResearchExecution" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Factor" ("analysisKind", "approvedReportId", "archivedAt", "code", "codeHash", "createdAt", "descriptionEn", "descriptionZh", "id", "key", "messages", "name", "publishedAt", "status", "updatedAt", "userId", "visibility") SELECT "analysisKind", "approvedReportId", "archivedAt", "code", "codeHash", "createdAt", "descriptionEn", "descriptionZh", "id", "key", "messages", "name", "publishedAt", "status", "updatedAt", "userId", "visibility" FROM "Factor";
DROP TABLE "Factor";
ALTER TABLE "new_Factor" RENAME TO "Factor";
CREATE UNIQUE INDEX "Factor_approvedReportId_key" ON "Factor"("approvedReportId");
CREATE UNIQUE INDEX "Factor_sourceResearchExecutionId_key" ON "Factor"("sourceResearchExecutionId");
CREATE INDEX "Factor_userId_updatedAt_idx" ON "Factor"("userId", "updatedAt");
CREATE INDEX "Factor_visibility_status_updatedAt_idx" ON "Factor"("visibility", "status", "updatedAt");
CREATE UNIQUE INDEX "Factor_userId_key_key" ON "Factor"("userId", "key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
