-- CreateTable
CREATE TABLE "IndexWeight" (
    "indexCode" TEXT NOT NULL,
    "conCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "weight" REAL,

    PRIMARY KEY ("indexCode", "conCode", "tradeDate")
);

-- CreateIndex
CREATE INDEX "IndexWeight_indexCode_tradeDate_idx" ON "IndexWeight"("indexCode", "tradeDate");
