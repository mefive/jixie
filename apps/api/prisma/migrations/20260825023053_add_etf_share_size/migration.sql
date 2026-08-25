-- CreateTable
CREATE TABLE "EtfShareSize" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "availableDate" TEXT NOT NULL,
    "totalShare" REAL NOT NULL,
    "totalSize" REAL NOT NULL,
    "nav" REAL,
    "close" REAL,
    "exchange" TEXT NOT NULL,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateIndex
CREATE INDEX "EtfShareSize_tradeDate_idx" ON "EtfShareSize"("tradeDate");

-- CreateIndex
CREATE INDEX "EtfShareSize_availableDate_idx" ON "EtfShareSize"("availableDate");
