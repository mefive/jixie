-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FutureContract" (
    "tsCode" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "multiplier" REAL,
    "tradeUnit" TEXT,
    "perUnit" REAL,
    "quoteUnit" TEXT,
    "quoteUnitDesc" TEXT,
    "deliveryMode" TEXT,
    "listDate" TEXT NOT NULL,
    "delistDate" TEXT NOT NULL,
    "deliveryMonth" TEXT,
    "lastDeliveryDate" TEXT,
    "tradeTimeDesc" TEXT
);
INSERT INTO "new_FutureContract" ("delistDate", "deliveryMode", "deliveryMonth", "exchange", "lastDeliveryDate", "listDate", "multiplier", "name", "perUnit", "productCode", "quoteUnit", "quoteUnitDesc", "symbol", "tradeTimeDesc", "tradeUnit", "tsCode") SELECT "delistDate", "deliveryMode", "deliveryMonth", "exchange", "lastDeliveryDate", "listDate", "multiplier", "name", "perUnit", "productCode", "quoteUnit", "quoteUnitDesc", "symbol", "tradeTimeDesc", "tradeUnit", "tsCode" FROM "FutureContract";
DROP TABLE "FutureContract";
ALTER TABLE "new_FutureContract" RENAME TO "FutureContract";
CREATE INDEX "FutureContract_productCode_idx" ON "FutureContract"("productCode");
CREATE INDEX "FutureContract_listDate_delistDate_idx" ON "FutureContract"("listDate", "delistDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
