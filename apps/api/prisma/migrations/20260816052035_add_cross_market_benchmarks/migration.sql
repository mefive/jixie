-- CreateTable
CREATE TABLE "MarketBenchmark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "observesDaylightSavingTime" BOOLEAN NOT NULL,
    "returnType" TEXT NOT NULL,
    "dataContractId" TEXT NOT NULL,
    "tradableProxyTsCode" TEXT NOT NULL,
    "tradableProxyKind" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "MarketBenchmarkDaily" (
    "benchmarkId" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "availableDate" TEXT NOT NULL,
    "open" REAL,
    "high" REAL,
    "low" REAL,
    "close" REAL NOT NULL,
    "preClose" REAL,
    "change" REAL,
    "pctChange" REAL,
    "swing" REAL,
    "volume" REAL,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("benchmarkId", "tradeDate"),
    CONSTRAINT "MarketBenchmarkDaily_benchmarkId_fkey" FOREIGN KEY ("benchmarkId") REFERENCES "MarketBenchmark" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MarketBenchmark_market_idx" ON "MarketBenchmark"("market");

-- CreateIndex
CREATE UNIQUE INDEX "MarketBenchmark_provider_providerCode_key" ON "MarketBenchmark"("provider", "providerCode");

-- CreateIndex
CREATE INDEX "MarketBenchmarkDaily_availableDate_idx" ON "MarketBenchmarkDaily"("availableDate");

-- CreateIndex
CREATE INDEX "MarketBenchmarkDaily_benchmarkId_availableDate_idx" ON "MarketBenchmarkDaily"("benchmarkId", "availableDate");
