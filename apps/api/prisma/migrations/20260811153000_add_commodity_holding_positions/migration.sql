CREATE TABLE "CommodityHoldingPosition" (
    "version" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "availableDate" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "referenceContract" TEXT NOT NULL,
    "sourceSymbol" TEXT NOT NULL,
    "selectionMethod" TEXT NOT NULL,
    "contractOpenInterest" REAL NOT NULL,
    "contractVolume" REAL NOT NULL,
    "rankedVolume" REAL NOT NULL,
    "rankedVolumeChange" REAL,
    "rankedLongHolding" REAL NOT NULL,
    "rankedLongChange" REAL,
    "rankedShortHolding" REAL NOT NULL,
    "rankedShortChange" REAL,
    "topFiveLongHolding" REAL NOT NULL,
    "topFiveShortHolding" REAL NOT NULL,
    "volumeMemberCount" INTEGER NOT NULL,
    "longMemberCount" INTEGER NOT NULL,
    "shortMemberCount" INTEGER NOT NULL,
    "sourceRowCount" INTEGER NOT NULL,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("productCode", "tradeDate")
);

CREATE INDEX "CommodityHoldingPosition_availableDate_idx"
ON "CommodityHoldingPosition"("availableDate");

CREATE INDEX "CommodityHoldingPosition_referenceContract_tradeDate_idx"
ON "CommodityHoldingPosition"("referenceContract", "tradeDate");
