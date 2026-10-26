-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Strategy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "messages" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Strategy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Strategy" ("config", "createdAt", "id", "messages", "name", "updatedAt", "userId") SELECT "config", "createdAt", "id", "messages", "name", "updatedAt", "userId" FROM "Strategy";
DROP TABLE "Strategy";
ALTER TABLE "new_Strategy" RENAME TO "Strategy";
CREATE INDEX "Strategy_userId_updatedAt_idx" ON "Strategy"("userId", "updatedAt");
CREATE UNIQUE INDEX "Strategy_userId_name_key" ON "Strategy"("userId", "name");
CREATE TABLE "new_BacktestReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "strategyName" TEXT NOT NULL,
    "status" TEXT,
    "config" JSONB NOT NULL,
    "inputSignature" TEXT,
    "payload" JSONB,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedAt" DATETIME,
    CONSTRAINT "BacktestReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BacktestReport_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BacktestReport" ("computedAt", "config", "createdAt", "error", "id", "payload", "status", "strategyId", "strategyName", "userId") SELECT "computedAt", "config", "createdAt", "error", "id", "payload", "status", "strategyId", "strategyName", "userId" FROM "BacktestReport";
DROP TABLE "BacktestReport";
ALTER TABLE "new_BacktestReport" RENAME TO "BacktestReport";
CREATE INDEX "BacktestReport_userId_strategyId_createdAt_idx" ON "BacktestReport"("userId", "strategyId", "createdAt");
CREATE INDEX "BacktestReport_userId_status_createdAt_idx" ON "BacktestReport"("userId", "status", "createdAt");
CREATE TABLE "new_StrategyScanReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "strategyName" TEXT NOT NULL,
    "status" TEXT,
    "config" JSONB NOT NULL,
    "spec" JSONB NOT NULL,
    "inputSignature" TEXT,
    "dataCutoff" TEXT,
    "payload" JSONB,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StrategyScanReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StrategyScanReport_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_StrategyScanReport" ("config", "createdAt", "dataCutoff", "error", "id", "payload", "spec", "status", "strategyId", "strategyName", "updatedAt", "userId") SELECT "config", "createdAt", "dataCutoff", "error", "id", "payload", "spec", "status", "strategyId", "strategyName", "updatedAt", "userId" FROM "StrategyScanReport";
DROP TABLE "StrategyScanReport";
ALTER TABLE "new_StrategyScanReport" RENAME TO "StrategyScanReport";
CREATE INDEX "StrategyScanReport_userId_strategyId_createdAt_idx" ON "StrategyScanReport"("userId", "strategyId", "createdAt");
CREATE INDEX "StrategyScanReport_userId_status_idx" ON "StrategyScanReport"("userId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

