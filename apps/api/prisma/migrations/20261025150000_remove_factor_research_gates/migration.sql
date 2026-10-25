-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FactorReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "factor" TEXT NOT NULL,
    "status" TEXT,
    "analysisKind" TEXT NOT NULL DEFAULT 'cross_sectional',
    "language" TEXT NOT NULL DEFAULT 'typescript',
    "runtimeVersion" TEXT NOT NULL DEFAULT 'ts-v1',
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedAt" DATETIME
);
INSERT INTO "new_FactorReport" ("analysisKind", "computedAt", "createdAt", "dataRevision", "end", "error", "factor", "factorCodeHash", "factorCodeSnapshot", "freq", "id", "language", "neutral", "payload", "runtimeVersion", "specJson", "start", "status", "userId", "variantKey") SELECT "analysisKind", "computedAt", "createdAt", "dataRevision", "end", "error", "factor", "factorCodeHash", "factorCodeSnapshot", "freq", "id", "language", "neutral", "payload", "runtimeVersion", "specJson", "start", "status", "userId", "variantKey" FROM "FactorReport";
DROP TABLE "FactorReport";
ALTER TABLE "new_FactorReport" RENAME TO "FactorReport";
CREATE INDEX "FactorReport_userId_factor_createdAt_idx" ON "FactorReport"("userId", "factor", "createdAt");
CREATE INDEX "FactorReport_userId_variantKey_idx" ON "FactorReport"("userId", "variantKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
