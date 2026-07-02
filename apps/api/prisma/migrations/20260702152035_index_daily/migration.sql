-- CreateTable
CREATE TABLE "IndexDaily" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "close" REAL NOT NULL,

    PRIMARY KEY ("tsCode", "tradeDate")
);
