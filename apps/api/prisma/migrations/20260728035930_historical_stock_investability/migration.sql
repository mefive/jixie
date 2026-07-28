-- CreateTable
CREATE TABLE "StockCodeChange" (
    "oldTsCode" TEXT NOT NULL PRIMARY KEY,
    "newTsCode" TEXT NOT NULL,
    "effectiveDate" TEXT NOT NULL,
    "source" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "StockNameHistory" (
    "tsCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "announcementDate" TEXT,
    "changeReason" TEXT,

    PRIMARY KEY ("tsCode", "startDate")
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StockBasic" (
    "tsCode" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT,
    "industry" TEXT,
    "market" TEXT NOT NULL,
    "listDate" TEXT,
    "delistDate" TEXT,
    "listStatus" TEXT NOT NULL
);
INSERT INTO "new_StockBasic" ("area", "industry", "listDate", "listStatus", "market", "name", "symbol", "tsCode") SELECT "area", "industry", "listDate", "listStatus", "market", "name", "symbol", "tsCode" FROM "StockBasic";
DROP TABLE "StockBasic";
ALTER TABLE "new_StockBasic" RENAME TO "StockBasic";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "StockCodeChange_newTsCode_idx" ON "StockCodeChange"("newTsCode");

-- CreateIndex
CREATE INDEX "StockNameHistory_tsCode_endDate_idx" ON "StockNameHistory"("tsCode", "endDate");

-- CreateIndex
CREATE INDEX "StockNameHistory_announcementDate_idx" ON "StockNameHistory"("announcementDate");
