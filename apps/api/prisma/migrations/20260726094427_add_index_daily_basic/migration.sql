-- CreateTable
CREATE TABLE "IndexDailyBasic" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "totalMv" REAL,
    "floatMv" REAL,
    "totalShare" REAL,
    "floatShare" REAL,
    "freeShare" REAL,
    "turnoverRate" REAL,
    "turnoverRateF" REAL,
    "pe" REAL,
    "peTtm" REAL,
    "pb" REAL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateIndex
CREATE INDEX "IndexDailyBasic_tradeDate_idx" ON "IndexDailyBasic"("tradeDate");
