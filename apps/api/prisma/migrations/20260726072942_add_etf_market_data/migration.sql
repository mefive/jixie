-- CreateTable
CREATE TABLE "EtfBasic" (
    "tsCode" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "fullName" TEXT,
    "indexCode" TEXT,
    "indexName" TEXT,
    "setupDate" TEXT,
    "listDate" TEXT NOT NULL,
    "delistDate" TEXT,
    "listStatus" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "managerName" TEXT,
    "custodianName" TEXT,
    "managementFee" REAL,
    "fundType" TEXT,
    "etfType" TEXT,
    "sameDayTurnover" BOOLEAN NOT NULL,
    "lotSize" INTEGER NOT NULL DEFAULT 100
);

-- CreateTable
CREATE TABLE "EtfDaily" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "open" REAL,
    "high" REAL,
    "low" REAL,
    "close" REAL,
    "preClose" REAL,
    "pctChg" REAL,
    "vol" REAL,
    "amount" REAL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateTable
CREATE TABLE "EtfAdjFactor" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "adjFactor" REAL NOT NULL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateTable
CREATE TABLE "EtfSyncSlice" (
    "tsCode" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "completedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("tsCode", "startDate", "endDate")
);

-- CreateIndex
CREATE INDEX "EtfDaily_tradeDate_idx" ON "EtfDaily"("tradeDate");

-- CreateIndex
CREATE INDEX "EtfAdjFactor_tradeDate_idx" ON "EtfAdjFactor"("tradeDate");
