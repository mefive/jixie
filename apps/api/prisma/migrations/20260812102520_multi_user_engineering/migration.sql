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
    "codeHash" TEXT,
    "publishedAt" DATETIME,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Factor_approvedReportId_fkey" FOREIGN KEY ("approvedReportId") REFERENCES "FactorReport" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Factor" ("analysisKind", "approvedReportId", "archivedAt", "code", "codeHash", "createdAt", "descriptionEn", "descriptionZh", "id", "key", "messages", "name", "publishedAt", "status", "updatedAt", "userId") SELECT "analysisKind", "approvedReportId", "archivedAt", "code", "codeHash", "createdAt", "descriptionEn", "descriptionZh", "id", "key", "messages", "name", "publishedAt", "status", "updatedAt", "userId" FROM "Factor";
DROP TABLE "Factor";
ALTER TABLE "new_Factor" RENAME TO "Factor";
CREATE UNIQUE INDEX "Factor_approvedReportId_key" ON "Factor"("approvedReportId");
CREATE INDEX "Factor_userId_updatedAt_idx" ON "Factor"("userId", "updatedAt");
CREATE INDEX "Factor_visibility_status_updatedAt_idx" ON "Factor"("visibility", "status", "updatedAt");
CREATE UNIQUE INDEX "Factor_userId_key_key" ON "Factor"("userId", "key");
CREATE TABLE "new_FactorComposite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "visibility" TEXT NOT NULL DEFAULT 'private',
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
CREATE INDEX "FactorComposite_visibility_status_updatedAt_idx" ON "FactorComposite"("visibility", "status", "updatedAt");
CREATE UNIQUE INDEX "FactorComposite_userId_key_key" ON "FactorComposite"("userId", "key");
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB,
    "error" TEXT,
    "logs" TEXT,
    "factorReportId" TEXT,
    "strategyScanReportId" TEXT,
    "signalRunId" TEXT,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_factorReportId_fkey" FOREIGN KEY ("factorReportId") REFERENCES "FactorReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_strategyScanReportId_fkey" FOREIGN KEY ("strategyScanReportId") REFERENCES "StrategyScanReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_signalRunId_fkey" FOREIGN KEY ("signalRunId") REFERENCES "SignalRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("createdAt", "error", "factorReportId", "id", "key", "kind", "logs", "signalRunId", "status", "strategyScanReportId", "updatedAt", "userId") SELECT "createdAt", "error", "factorReportId", "id", "key", "kind", "logs", "signalRunId", "status", "strategyScanReportId", "updatedAt", "userId" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE UNIQUE INDEX "Job_factorReportId_key" ON "Job"("factorReportId");
CREATE UNIQUE INDEX "Job_strategyScanReportId_key" ON "Job"("strategyScanReportId");
CREATE INDEX "Job_userId_kind_key_status_idx" ON "Job"("userId", "kind", "key", "status");
CREATE INDEX "Job_signalRunId_createdAt_idx" ON "Job"("signalRunId", "createdAt");
CREATE TABLE "new_Strategy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "lastResult" JSONB,
    "messages" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Strategy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Strategy" ("config", "createdAt", "id", "lastResult", "messages", "name", "updatedAt", "userId") SELECT "config", "createdAt", "id", "lastResult", "messages", "name", "updatedAt", "userId" FROM "Strategy";
DROP TABLE "Strategy";
ALTER TABLE "new_Strategy" RENAME TO "Strategy";
CREATE INDEX "Strategy_userId_updatedAt_idx" ON "Strategy"("userId", "updatedAt");
CREATE INDEX "Strategy_visibility_updatedAt_idx" ON "Strategy"("visibility", "updatedAt");
CREATE UNIQUE INDEX "Strategy_userId_name_key" ON "Strategy"("userId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
