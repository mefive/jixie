-- CreateTable
CREATE TABLE "FactorWeatherPin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "factorId" TEXT NOT NULL,
    "factorName" TEXT NOT NULL,
    "builtin" BOOLEAN NOT NULL,
    "direction" TEXT NOT NULL,
    "factorCode" TEXT NOT NULL,
    "factorCodeHash" TEXT NOT NULL,
    "methodologyHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "computedThrough" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FactorWeatherPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FactorWeatherPin_factorId_fkey" FOREIGN KEY ("factorId") REFERENCES "Factor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FactorWeatherPoint" (
    "pinId" TEXT NOT NULL,
    "formationDate" TEXT NOT NULL,
    "periodEndDate" TEXT NOT NULL,
    "rankIc" REAL NOT NULL,
    "topReturn" REAL NOT NULL,
    "bottomReturn" REAL NOT NULL,
    "longShortGrossReturn" REAL NOT NULL,
    "longShortNetReturn" REAL NOT NULL,
    "topTurnover" REAL,
    "sampleSize" INTEGER NOT NULL,
    "sampleCoverage" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("pinId", "periodEndDate"),
    CONSTRAINT "FactorWeatherPoint_pinId_fkey" FOREIGN KEY ("pinId") REFERENCES "FactorWeatherPin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FactorWeatherPin_status_updatedAt_idx" ON "FactorWeatherPin"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FactorWeatherPin_userId_factorId_key" ON "FactorWeatherPin"("userId", "factorId");

-- CreateIndex
CREATE INDEX "FactorWeatherPoint_periodEndDate_idx" ON "FactorWeatherPoint"("periodEndDate");
