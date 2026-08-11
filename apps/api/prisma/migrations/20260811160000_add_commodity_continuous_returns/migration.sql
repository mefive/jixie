CREATE TABLE "CommodityContinuousReturn" (
    "version" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "availableDate" TEXT NOT NULL,
    "continuousCode" TEXT NOT NULL,
    "mappingMethod" TEXT NOT NULL,
    "mappedContract" TEXT NOT NULL,
    "previousTradeDate" TEXT NOT NULL,
    "previousMappedContract" TEXT NOT NULL,
    "settlement" REAL NOT NULL,
    "sameContractPreviousSettlement" REAL NOT NULL,
    "previousMappedSettlement" REAL NOT NULL,
    "continuousReturn" REAL NOT NULL,
    "continuousLogReturn" REAL NOT NULL,
    "mappedLogReturn" REAL NOT NULL,
    "rollGapLogReturn" REAL NOT NULL,
    "rollYieldProxy" REAL NOT NULL,
    "mappingChanged" BOOLEAN NOT NULL,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("productCode", "tradeDate")
);

CREATE INDEX "CommodityContinuousReturn_availableDate_idx"
ON "CommodityContinuousReturn"("availableDate");

CREATE INDEX "CommodityContinuousReturn_continuousCode_tradeDate_idx"
ON "CommodityContinuousReturn"("continuousCode", "tradeDate");

CREATE INDEX "CommodityContinuousReturn_mappedContract_tradeDate_idx"
ON "CommodityContinuousReturn"("mappedContract", "tradeDate");
