-- CreateTable
CREATE TABLE "Moneyflow" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "netMain" REAL NOT NULL,
    "netTotal" REAL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateIndex
CREATE INDEX "Moneyflow_tradeDate_idx" ON "Moneyflow"("tradeDate");
