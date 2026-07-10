-- CreateTable
CREATE TABLE "FutureContract" (
    "tsCode" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "multiplier" REAL NOT NULL,
    "tradeUnit" TEXT,
    "perUnit" REAL,
    "quoteUnit" TEXT,
    "quoteUnitDesc" TEXT,
    "deliveryMode" TEXT,
    "listDate" TEXT NOT NULL,
    "delistDate" TEXT NOT NULL,
    "deliveryMonth" TEXT,
    "lastDeliveryDate" TEXT,
    "tradeTimeDesc" TEXT
);

-- CreateTable
CREATE TABLE "FutureDaily" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "preClose" REAL,
    "preSettle" REAL,
    "open" REAL,
    "high" REAL,
    "low" REAL,
    "close" REAL,
    "settle" REAL,
    "changeClose" REAL,
    "changeSettle" REAL,
    "volume" REAL,
    "amount" REAL,
    "openInterest" REAL,
    "openInterestChange" REAL,
    "deliverySettle" REAL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateTable
CREATE TABLE "FutureMapping" (
    "continuousCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "mappedTsCode" TEXT NOT NULL,

    PRIMARY KEY ("continuousCode", "tradeDate")
);

-- CreateTable
CREATE TABLE "FutureSettlement" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "settle" REAL,
    "tradingFeeRate" REAL,
    "tradingFee" REAL,
    "deliveryFee" REAL,
    "buyHedgeMarginRate" REAL,
    "sellHedgeMarginRate" REAL,
    "longMarginRate" REAL,
    "shortMarginRate" REAL,
    "closeTodayFee" REAL,
    "exchange" TEXT,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateIndex
CREATE INDEX "FutureContract_productCode_idx" ON "FutureContract"("productCode");

-- CreateIndex
CREATE INDEX "FutureContract_listDate_delistDate_idx" ON "FutureContract"("listDate", "delistDate");

-- CreateIndex
CREATE INDEX "FutureDaily_tradeDate_idx" ON "FutureDaily"("tradeDate");

-- CreateIndex
CREATE INDEX "FutureMapping_tradeDate_idx" ON "FutureMapping"("tradeDate");

-- CreateIndex
CREATE INDEX "FutureMapping_mappedTsCode_idx" ON "FutureMapping"("mappedTsCode");

-- CreateIndex
CREATE INDEX "FutureSettlement_tradeDate_idx" ON "FutureSettlement"("tradeDate");
