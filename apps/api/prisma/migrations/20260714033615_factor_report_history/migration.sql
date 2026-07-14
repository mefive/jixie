-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FactorReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "factor" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'done',
    "phase" TEXT NOT NULL DEFAULT 'legacy',
    "freq" TEXT NOT NULL,
    "neutral" TEXT NOT NULL DEFAULT 'none',
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "specJson" TEXT,
    "variantKey" TEXT,
    "factorCodeSnapshot" TEXT,
    "factorCodeHash" TEXT,
    "dataRevision" TEXT,
    "payload" TEXT,
    "error" TEXT,
    "parentReportId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedAt" DATETIME
);
INSERT INTO "new_FactorReport" ("computedAt", "end", "factor", "freq", "id", "neutral", "payload", "start", "userId") SELECT "computedAt", "end", "factor", "freq", "id", "neutral", "payload", "start", "userId" FROM "FactorReport";
DROP TABLE "FactorReport";
ALTER TABLE "new_FactorReport" RENAME TO "FactorReport";
CREATE INDEX "FactorReport_userId_factor_createdAt_idx" ON "FactorReport"("userId", "factor", "createdAt");
CREATE INDEX "FactorReport_userId_variantKey_idx" ON "FactorReport"("userId", "variantKey");
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "logs" TEXT,
    "factorReportId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_factorReportId_fkey" FOREIGN KEY ("factorReportId") REFERENCES "FactorReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("createdAt", "error", "id", "key", "kind", "logs", "status", "updatedAt", "userId") SELECT "createdAt", "error", "id", "key", "kind", "logs", "status", "updatedAt", "userId" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE UNIQUE INDEX "Job_factorReportId_key" ON "Job"("factorReportId");
CREATE INDEX "Job_userId_kind_key_status_idx" ON "Job"("userId", "kind", "key", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
