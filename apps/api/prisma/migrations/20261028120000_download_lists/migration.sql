-- DropIndex
DROP INDEX "EtfShareSize_tradeDate_idx";

-- DropIndex
DROP INDEX "EtfShareSize_availableDate_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "EtfShareSize";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "MarketDownloadList" (
    "assetType" TEXT NOT NULL PRIMARY KEY,
    "codes" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EtfLatestSize" (
    "tsCode" TEXT NOT NULL PRIMARY KEY,
    "tradeDate" TEXT NOT NULL,
    "totalSize" REAL,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_IndexBenchmark" (
    "tsCode" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT,
    "bmkLevel" TEXT,
    "bmkType" TEXT,
    "bmkSource" TEXT,
    "indexType" TEXT
);
INSERT INTO "new_IndexBenchmark" ("bmkLevel", "bmkSource", "bmkType", "fullName", "indexType", "name", "symbol", "tsCode") SELECT "bmkLevel", "bmkSource", "bmkType", "fullName", "indexType", "name", "symbol", "tsCode" FROM "IndexBenchmark";
DROP TABLE "IndexBenchmark";
ALTER TABLE "new_IndexBenchmark" RENAME TO "IndexBenchmark";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

