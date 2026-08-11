CREATE TABLE "FxDaily" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "availableDate" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "bidOpen" REAL NOT NULL,
    "bidClose" REAL NOT NULL,
    "bidHigh" REAL NOT NULL,
    "bidLow" REAL NOT NULL,
    "askOpen" REAL NOT NULL,
    "askClose" REAL NOT NULL,
    "askHigh" REAL NOT NULL,
    "askLow" REAL NOT NULL,
    "tickQty" INTEGER NOT NULL,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("tsCode", "tradeDate")
);

CREATE INDEX "FxDaily_availableDate_idx" ON "FxDaily"("availableDate");
