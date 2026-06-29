-- CreateTable
CREATE TABLE "StkLimit" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "upLimit" REAL NOT NULL,
    "downLimit" REAL NOT NULL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateIndex
CREATE INDEX "StkLimit_tradeDate_idx" ON "StkLimit"("tradeDate");
