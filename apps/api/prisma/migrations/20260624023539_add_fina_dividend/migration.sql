-- CreateTable
CREATE TABLE "FinaIndicator" (
    "tsCode" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "annDate" TEXT,
    "roe" REAL,
    "roeWaa" REAL,

    PRIMARY KEY ("tsCode", "endDate")
);

-- CreateTable
CREATE TABLE "Dividend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tsCode" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "annDate" TEXT,
    "exDate" TEXT,
    "divProc" TEXT,
    "cashDiv" REAL,
    "cashDivTax" REAL
);

-- CreateIndex
CREATE INDEX "FinaIndicator_annDate_idx" ON "FinaIndicator"("annDate");

-- CreateIndex
CREATE INDEX "Dividend_tsCode_idx" ON "Dividend"("tsCode");
