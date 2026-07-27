-- CreateTable
CREATE TABLE "MarketIndicator" (
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
    "limitUpCount" INTEGER NOT NULL,
    "limitDownCount" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "IndustryIndicator" (
    "l1Code" TEXT NOT NULL,
    "l1Name" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "tradedCount" INTEGER NOT NULL,
    "return20" REAL,
    "excessReturn20" REAL,
    "positiveReturn20Ratio" REAL,
    "aboveMa20Ratio" REAL,
    "aboveMa60Ratio" REAL,
    "floatWeightedTurnoverRate" REAL,
    "amountShare" REAL,
    "topFiveAmountShare" REAL,

    PRIMARY KEY ("l1Code", "tradeDate")
);

-- CreateIndex
CREATE INDEX "IndustryIndicator_tradeDate_idx" ON "IndustryIndicator"("tradeDate");
