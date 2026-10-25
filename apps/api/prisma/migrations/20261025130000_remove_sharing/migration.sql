-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Strategy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "lastResult" JSONB,
    "messages" JSONB,
    "sourceResearchExecutionId" TEXT,
    "researchHandoff" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Strategy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Strategy_sourceResearchExecutionId_fkey" FOREIGN KEY ("sourceResearchExecutionId") REFERENCES "ResearchExecution" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Strategy" ("config", "createdAt", "id", "lastResult", "messages", "name", "researchHandoff", "sourceResearchExecutionId", "updatedAt", "userId") SELECT "config", "createdAt", "id", "lastResult", "messages", "name", "researchHandoff", "sourceResearchExecutionId", "updatedAt", "userId" FROM "Strategy";
DROP TABLE "Strategy";
ALTER TABLE "new_Strategy" RENAME TO "Strategy";
CREATE UNIQUE INDEX "Strategy_sourceResearchExecutionId_key" ON "Strategy"("sourceResearchExecutionId");
CREATE INDEX "Strategy_userId_updatedAt_idx" ON "Strategy"("userId", "updatedAt");
CREATE UNIQUE INDEX "Strategy_userId_name_key" ON "Strategy"("userId", "name");
CREATE TABLE "new_Factor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "analysisKind" TEXT NOT NULL DEFAULT 'cross_sectional',
    "language" TEXT NOT NULL DEFAULT 'typescript',
    "runtimeVersion" TEXT NOT NULL DEFAULT 'ts-v1',
    "descriptionZh" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL,
    "messages" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
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
INSERT INTO "new_Factor" ("analysisKind", "approvedReportId", "archivedAt", "code", "codeHash", "createdAt", "descriptionEn", "descriptionZh", "id", "key", "language", "messages", "name", "publishedAt", "researchHandoff", "runtimeVersion", "sourceResearchExecutionId", "status", "updatedAt", "userId") SELECT "analysisKind", "approvedReportId", "archivedAt", "code", "codeHash", "createdAt", "descriptionEn", "descriptionZh", "id", "key", "language", "messages", "name", "publishedAt", "researchHandoff", "runtimeVersion", "sourceResearchExecutionId", "status", "updatedAt", "userId" FROM "Factor";
DROP TABLE "Factor";
ALTER TABLE "new_Factor" RENAME TO "Factor";
CREATE UNIQUE INDEX "Factor_approvedReportId_key" ON "Factor"("approvedReportId");
CREATE UNIQUE INDEX "Factor_sourceResearchExecutionId_key" ON "Factor"("sourceResearchExecutionId");
CREATE INDEX "Factor_userId_updatedAt_idx" ON "Factor"("userId", "updatedAt");
CREATE UNIQUE INDEX "Factor_userId_key_key" ON "Factor"("userId", "key");
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
INSERT INTO "new_FactorComposite" ("approvedReportId", "archivedAt", "codeHash", "createdAt", "definition", "id", "key", "name", "publishedAt", "status", "updatedAt", "userId") SELECT "approvedReportId", "archivedAt", "codeHash", "createdAt", "definition", "id", "key", "name", "publishedAt", "status", "updatedAt", "userId" FROM "FactorComposite";
DROP TABLE "FactorComposite";
ALTER TABLE "new_FactorComposite" RENAME TO "FactorComposite";
CREATE UNIQUE INDEX "FactorComposite_approvedReportId_key" ON "FactorComposite"("approvedReportId");
CREATE INDEX "FactorComposite_userId_updatedAt_idx" ON "FactorComposite"("userId", "updatedAt");
CREATE UNIQUE INDEX "FactorComposite_userId_key_key" ON "FactorComposite"("userId", "key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
