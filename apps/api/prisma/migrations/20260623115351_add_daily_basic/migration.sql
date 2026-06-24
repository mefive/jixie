-- CreateTable
CREATE TABLE "DailyBasic" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "pe" REAL,
    "peTtm" REAL,
    "pb" REAL,
    "ps" REAL,
    "psTtm" REAL,
    "dvRatio" REAL,
    "dvTtm" REAL,
    "totalMv" REAL,
    "circMv" REAL,
    "turnoverRate" REAL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateIndex
CREATE INDEX "DailyBasic_tradeDate_idx" ON "DailyBasic"("tradeDate");
