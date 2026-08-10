-- CreateTable
CREATE TABLE "CommodityWarehouseReceipt" (
    "productCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "availableDate" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "volume" REAL NOT NULL,
    "volumeChange" REAL,
    "sourceRowCount" INTEGER NOT NULL,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("productCode", "tradeDate")
);

-- CreateIndex
CREATE INDEX "CommodityWarehouseReceipt_tradeDate_idx" ON "CommodityWarehouseReceipt"("tradeDate");

-- CreateIndex
CREATE INDEX "CommodityWarehouseReceipt_availableDate_idx" ON "CommodityWarehouseReceipt"("availableDate");
