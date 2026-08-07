-- CreateTable
CREATE TABLE "YieldCurvePoint" (
    "source" TEXT NOT NULL,
    "curveCode" TEXT NOT NULL,
    "curveName" TEXT NOT NULL,
    "curveType" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "availableDate" TEXT NOT NULL,
    "termYears" REAL NOT NULL,
    "yieldPct" REAL NOT NULL,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("source", "curveCode", "curveType", "tradeDate", "termYears")
);

-- CreateIndex
CREATE INDEX "YieldCurvePoint_curveCode_availableDate_idx" ON "YieldCurvePoint"("curveCode", "availableDate");

-- CreateIndex
CREATE INDEX "YieldCurvePoint_tradeDate_idx" ON "YieldCurvePoint"("tradeDate");
