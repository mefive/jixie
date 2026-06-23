-- CreateTable
CREATE TABLE "FactorValue" (
    "factor" TEXT NOT NULL,
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "value" REAL NOT NULL,

    PRIMARY KEY ("factor", "tsCode", "tradeDate")
);

-- CreateIndex
CREATE INDEX "FactorValue_factor_tradeDate_idx" ON "FactorValue"("factor", "tradeDate");
