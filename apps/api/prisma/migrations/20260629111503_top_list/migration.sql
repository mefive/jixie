-- CreateTable
CREATE TABLE "TopList" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "netAmount" REAL NOT NULL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateIndex
CREATE INDEX "TopList_tradeDate_idx" ON "TopList"("tradeDate");
