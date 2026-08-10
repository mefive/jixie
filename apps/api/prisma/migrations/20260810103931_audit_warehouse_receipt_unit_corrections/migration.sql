-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CommodityWarehouseReceipt" (
    "productCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "availableDate" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUnit" TEXT,
    "unit" TEXT NOT NULL,
    "unitCorrectionApplied" BOOLEAN NOT NULL DEFAULT false,
    "volume" REAL NOT NULL,
    "volumeChange" REAL,
    "sourceRowCount" INTEGER NOT NULL,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("productCode", "tradeDate")
);
INSERT INTO "new_CommodityWarehouseReceipt" ("availableDate", "productCode", "retrievedAt", "sourceName", "sourceRowCount", "tradeDate", "unit", "volume", "volumeChange") SELECT "availableDate", "productCode", "retrievedAt", "sourceName", "sourceRowCount", "tradeDate", "unit", "volume", "volumeChange" FROM "CommodityWarehouseReceipt";
DROP TABLE "CommodityWarehouseReceipt";
ALTER TABLE "new_CommodityWarehouseReceipt" RENAME TO "CommodityWarehouseReceipt";
CREATE INDEX "CommodityWarehouseReceipt_tradeDate_idx" ON "CommodityWarehouseReceipt"("tradeDate");
CREATE INDEX "CommodityWarehouseReceipt_availableDate_idx" ON "CommodityWarehouseReceipt"("availableDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
