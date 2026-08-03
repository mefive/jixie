-- CreateTable
CREATE TABLE "IndexBenchmark" (
    "tsCode" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "bmkLevel" TEXT NOT NULL,
    "bmkType" TEXT NOT NULL,
    "bmkSource" TEXT NOT NULL,
    "indexType" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "SwIndexDaily" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "open" REAL,
    "low" REAL,
    "high" REAL,
    "close" REAL,
    "change" REAL,
    "pctChange" REAL,
    "volume" REAL,
    "amount" REAL,
    "pe" REAL,
    "pb" REAL,
    "floatMv" REAL,
    "totalMv" REAL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateIndex
CREATE INDEX "SwIndexDaily_tradeDate_idx" ON "SwIndexDaily"("tradeDate");
