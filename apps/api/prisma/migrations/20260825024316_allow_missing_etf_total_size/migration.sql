-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EtfShareSize" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "availableDate" TEXT NOT NULL,
    "totalShare" REAL NOT NULL,
    "totalSize" REAL,
    "nav" REAL,
    "close" REAL,
    "exchange" TEXT NOT NULL,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("tsCode", "tradeDate")
);
INSERT INTO "new_EtfShareSize" ("availableDate", "close", "exchange", "nav", "retrievedAt", "totalShare", "totalSize", "tradeDate", "tsCode") SELECT "availableDate", "close", "exchange", "nav", "retrievedAt", "totalShare", "totalSize", "tradeDate", "tsCode" FROM "EtfShareSize";
DROP TABLE "EtfShareSize";
ALTER TABLE "new_EtfShareSize" RENAME TO "EtfShareSize";
CREATE INDEX "EtfShareSize_tradeDate_idx" ON "EtfShareSize"("tradeDate");
CREATE INDEX "EtfShareSize_availableDate_idx" ON "EtfShareSize"("availableDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
