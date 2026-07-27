-- CreateTable
CREATE TABLE "IndexIndicator" (
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
    "topFivePercentAmountShare" REAL,
    "extremeMoveRatio" REAL,
    "limitUpCount" INTEGER NOT NULL,
    "limitDownCount" INTEGER NOT NULL,

    PRIMARY KEY ("indexCode", "tradeDate")
);

-- CreateIndex
CREATE INDEX "IndexIndicator_tradeDate_idx" ON "IndexIndicator"("tradeDate");
