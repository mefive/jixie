-- AlterTable
ALTER TABLE "FactorReport" ADD COLUMN "marketVersionId" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "marketVersionId" TEXT;

-- AlterTable
ALTER TABLE "BacktestReport" ADD COLUMN "marketVersionId" TEXT;

-- AlterTable
ALTER TABLE "StrategyScanReport" ADD COLUMN "marketVersionId" TEXT;

-- AlterTable
ALTER TABLE "ResearchExecution" ADD COLUMN "marketVersionId" TEXT;

-- CreateTable
CREATE TABLE "MarketVersion" (
    "retained" BOOLEAN NOT NULL DEFAULT false,
    "historyVersionId" TEXT,
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "targetDate" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" DATETIME,
    "finishedAt" DATETIME,
    "rejectionReason" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "parentVersionId" TEXT,
    "parentSequence" INTEGER NOT NULL,
    "selectionVersion" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "activeSlot" INTEGER,
    "operation" TEXT,
    "candidateVersion" TEXT,
    "publishedAt" DATETIME,
    "publishedRevision" INTEGER
);

-- CreateTable
CREATE TABLE "MarketPublication" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "currentVersionId" TEXT,
    "previousVersionId" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "selectionVersion" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "MarketSelectionEdit" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "assetType" TEXT NOT NULL,
    "added" JSONB NOT NULL,
    "removed" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MarketRollback" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fromVersionId" TEXT NOT NULL,
    "toVersionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketVersion_runId_key" ON "MarketVersion"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketVersion_activeSlot_key" ON "MarketVersion"("activeSlot");
