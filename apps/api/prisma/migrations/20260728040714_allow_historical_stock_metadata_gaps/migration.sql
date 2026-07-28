-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StockBasic" (
    "tsCode" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT,
    "industry" TEXT,
    "market" TEXT,
    "listDate" TEXT,
    "delistDate" TEXT,
    "listStatus" TEXT NOT NULL
);
INSERT INTO "new_StockBasic" ("area", "delistDate", "industry", "listDate", "listStatus", "market", "name", "symbol", "tsCode") SELECT "area", "delistDate", "industry", "listDate", "listStatus", "market", "name", "symbol", "tsCode" FROM "StockBasic";
DROP TABLE "StockBasic";
ALTER TABLE "new_StockBasic" RENAME TO "StockBasic";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
