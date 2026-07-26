-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EtfBasic" (
    "tsCode" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "fullName" TEXT,
    "indexCode" TEXT,
    "indexName" TEXT,
    "setupDate" TEXT,
    "listDate" TEXT,
    "delistDate" TEXT,
    "listStatus" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "managerName" TEXT,
    "custodianName" TEXT,
    "managementFee" REAL,
    "fundType" TEXT,
    "etfType" TEXT,
    "sameDayTurnover" BOOLEAN NOT NULL,
    "lotSize" INTEGER NOT NULL DEFAULT 100
);
INSERT INTO "new_EtfBasic" ("custodianName", "delistDate", "etfType", "exchange", "fullName", "fundType", "indexCode", "indexName", "listDate", "listStatus", "lotSize", "managementFee", "managerName", "name", "sameDayTurnover", "setupDate", "tsCode") SELECT "custodianName", "delistDate", "etfType", "exchange", "fullName", "fundType", "indexCode", "indexName", "listDate", "listStatus", "lotSize", "managementFee", "managerName", "name", "sameDayTurnover", "setupDate", "tsCode" FROM "EtfBasic";
DROP TABLE "EtfBasic";
ALTER TABLE "new_EtfBasic" RENAME TO "EtfBasic";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
