-- AlterTable
ALTER TABLE "FactorWeatherPin" ADD COLUMN "dirtyFrom" TEXT;
ALTER TABLE "FactorWeatherPin" ADD COLUMN "inputRevision" INTEGER;

-- CreateTable
CREATE TABLE "DataSyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "summary" JSONB,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "DatasetSyncState" (
    "dataset" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "historyStart" TEXT NOT NULL,
    "backfillCursor" TEXT NOT NULL,
    "plannedThrough" TEXT,
    "recheckCursor" TEXT,
    "maxObservedDate" TEXT,
    "verifiedThrough" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" DATETIME,
    "lastBackfillAt" DATETIME,

    PRIMARY KEY ("dataset", "scope")
);

-- CreateTable
CREATE TABLE "DatasetSyncPartition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dataset" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "evidence" JSONB,
    "gaps" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastRunId" TEXT,
    "lastAttemptAt" DATETIME,
    "nextAttemptAt" DATETIME,
    "checkedAt" DATETIME
);

-- CreateTable
CREATE TABLE "MarketCalculationState" (
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "readyGeneration" INTEGER,
    "inputRevision" INTEGER,
    "inputVersions" JSONB,
    "dirtyScopes" JSONB,
    "nextAttemptAt" DATETIME,
    "calculationVersion" TEXT NOT NULL,
    "auditVersion" TEXT NOT NULL,
    "gaps" JSONB,
    "error" TEXT,
    "checkedAt" DATETIME,

    PRIMARY KEY ("kind", "scope", "date")
);

-- CreateTable
CREATE TABLE "MarketDataState" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketRecordEvidence" (
    "tableName" TEXT NOT NULL,
    "businessKey" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "fieldEvidence" JSONB NOT NULL,
    "publicationDate" TEXT,
    "availableDate" TEXT,
    "availabilityQuality" TEXT NOT NULL,
    "firstObservedAt" DATETIME NOT NULL,
    "lastFetchedAt" DATETIME NOT NULL,

    PRIMARY KEY ("tableName", "businessKey")
);

-- CreateTable
CREATE TABLE "FinaIndicatorVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tsCode" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "annDate" TEXT,
    "availableDate" TEXT NOT NULL,
    "availabilityQuality" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL,
    "roe" REAL,
    "roeWaa" REAL,
    "roa" REAL,
    "grossprofitMargin" REAL,
    "netprofitMargin" REAL,
    "debtToAssets" REAL,
    "orYoy" REAL,
    "netprofitYoy" REAL,
    "ocfToProfit" REAL
);

-- CreateTable
CREATE TABLE "FutureMarketRevision" (
    "tradeDate" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "dataRevision" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("tradeDate", "inputHash")
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_IndexIndicator" (
    "indexCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "membershipDate" TEXT NOT NULL,
    "tradedCount" INTEGER NOT NULL,
    "return20" REAL,
    "advanceRatio" REAL,
    "aboveMa20Ratio" REAL,
    "aboveMa60Ratio" REAL,
    "totalAmount" REAL,
    "floatWeightedTurnoverRate" REAL,
    "peTtm" REAL,
    "pb" REAL,
    "valuationCoverage" REAL,
    "topFivePercentAmountShare" REAL,
    "extremeMoveRatio" REAL,
    "limitUpCount" INTEGER,
    "limitDownCount" INTEGER,

    PRIMARY KEY ("indexCode", "tradeDate")
);
INSERT INTO "new_IndexIndicator" ("aboveMa20Ratio", "aboveMa60Ratio", "advanceRatio", "extremeMoveRatio", "floatWeightedTurnoverRate", "indexCode", "limitDownCount", "limitUpCount", "membershipDate", "pb", "peTtm", "return20", "topFivePercentAmountShare", "totalAmount", "tradeDate", "tradedCount", "valuationCoverage") SELECT "aboveMa20Ratio", "aboveMa60Ratio", "advanceRatio", "extremeMoveRatio", "floatWeightedTurnoverRate", "indexCode", "limitDownCount", "limitUpCount", "membershipDate", "pb", "peTtm", "return20", "topFivePercentAmountShare", "totalAmount", "tradeDate", "tradedCount", "valuationCoverage" FROM "IndexIndicator";
DROP TABLE "IndexIndicator";
ALTER TABLE "new_IndexIndicator" RENAME TO "IndexIndicator";
CREATE INDEX "IndexIndicator_tradeDate_idx" ON "IndexIndicator"("tradeDate");
CREATE TABLE "new_MarketIndicator" (
    "tradeDate" TEXT NOT NULL PRIMARY KEY,
    "tradedCount" INTEGER NOT NULL,
    "return20" REAL,
    "advanceRatio" REAL,
    "aboveMa20Ratio" REAL,
    "aboveMa60Ratio" REAL,
    "totalAmount" REAL,
    "floatWeightedTurnoverRate" REAL,
    "topFivePercentAmountShare" REAL,
    "extremeMoveRatio" REAL,
    "limitUpCount" INTEGER,
    "limitDownCount" INTEGER
);
INSERT INTO "new_MarketIndicator" ("aboveMa20Ratio", "aboveMa60Ratio", "advanceRatio", "extremeMoveRatio", "floatWeightedTurnoverRate", "limitDownCount", "limitUpCount", "return20", "topFivePercentAmountShare", "totalAmount", "tradeDate", "tradedCount") SELECT "aboveMa20Ratio", "aboveMa60Ratio", "advanceRatio", "extremeMoveRatio", "floatWeightedTurnoverRate", "limitDownCount", "limitUpCount", "return20", "topFivePercentAmountShare", "totalAmount", "tradeDate", "tradedCount" FROM "MarketIndicator";
DROP TABLE "MarketIndicator";
ALTER TABLE "new_MarketIndicator" RENAME TO "MarketIndicator";
CREATE TABLE "new_Moneyflow" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "netMain" REAL,
    "netTotal" REAL,

    PRIMARY KEY ("tsCode", "tradeDate")
);
INSERT INTO "new_Moneyflow" ("netMain", "netTotal", "tradeDate", "tsCode") SELECT "netMain", "netTotal", "tradeDate", "tsCode" FROM "Moneyflow";
DROP TABLE "Moneyflow";
ALTER TABLE "new_Moneyflow" RENAME TO "Moneyflow";
CREATE INDEX "Moneyflow_tradeDate_idx" ON "Moneyflow"("tradeDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DataSyncRun_startedAt_idx" ON "DataSyncRun"("startedAt");

-- CreateIndex
CREATE INDEX "DatasetSyncPartition_status_nextAttemptAt_idx" ON "DatasetSyncPartition"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "DatasetSyncPartition_dataset_scope_startDate_idx" ON "DatasetSyncPartition"("dataset", "scope", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetSyncPartition_dataset_scope_startDate_endDate_key" ON "DatasetSyncPartition"("dataset", "scope", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "MarketCalculationState_status_date_idx" ON "MarketCalculationState"("status", "date");

-- CreateIndex
CREATE INDEX "MarketRecordEvidence_dataset_idx" ON "MarketRecordEvidence"("dataset");

-- CreateIndex
CREATE UNIQUE INDEX "FinaIndicatorVersion_sourceFingerprint_key" ON "FinaIndicatorVersion"("sourceFingerprint");

-- CreateIndex
CREATE INDEX "FinaIndicatorVersion_tsCode_availableDate_idx" ON "FinaIndicatorVersion"("tsCode", "availableDate");

-- CreateIndex
CREATE INDEX "FutureMarketRevision_tradeDate_dataRevision_idx" ON "FutureMarketRevision"("tradeDate", "dataRevision");
