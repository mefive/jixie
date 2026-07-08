-- Cached factor-correlation reports (factor-to-strategy.md 3.4 correlation matrix).
CREATE TABLE "FactorCorrelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL
);
CREATE INDEX "FactorCorrelation_userId_idx" ON "FactorCorrelation"("userId");
