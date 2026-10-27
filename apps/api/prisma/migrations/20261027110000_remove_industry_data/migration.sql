-- DropIndex
DROP INDEX "SwIndustryMember_tsCode_idx";

-- DropIndex
DROP INDEX "SwIndexDaily_tradeDate_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SwIndustryMember";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SwIndexDaily";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StockBasic" (
    "tsCode" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT,
    "market" TEXT,
    "listDate" TEXT,
    "delistDate" TEXT,
    "listStatus" TEXT NOT NULL
);
INSERT INTO "new_StockBasic" ("area", "delistDate", "listDate", "listStatus", "market", "name", "symbol", "tsCode") SELECT "area", "delistDate", "listDate", "listStatus", "market", "name", "symbol", "tsCode" FROM "StockBasic";
DROP TABLE "StockBasic";
ALTER TABLE "new_StockBasic" RENAME TO "StockBasic";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

