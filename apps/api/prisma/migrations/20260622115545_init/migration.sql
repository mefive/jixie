-- CreateTable
CREATE TABLE "StockBasic" (
    "tsCode" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT,
    "industry" TEXT,
    "market" TEXT NOT NULL,
    "listDate" TEXT NOT NULL,
    "listStatus" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "TradeCal" (
    "exchange" TEXT NOT NULL,
    "calDate" TEXT NOT NULL,
    "isOpen" INTEGER NOT NULL,
    "pretradeDate" TEXT,

    PRIMARY KEY ("exchange", "calDate")
);

-- CreateTable
CREATE TABLE "Daily" (
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
CREATE TABLE "AdjFactor" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "adjFactor" REAL NOT NULL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateIndex
CREATE INDEX "Daily_tradeDate_idx" ON "Daily"("tradeDate");

-- CreateIndex
CREATE INDEX "AdjFactor_tradeDate_idx" ON "AdjFactor"("tradeDate");
