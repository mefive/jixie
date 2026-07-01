-- Redefine FactorReport → per-(factor,freq,start,end). The old single 'default' all-factor row is
-- obsolete, so it is dropped (not copied) — reports regenerate on demand.
PRAGMA foreign_keys=OFF;
DROP TABLE "FactorReport";
CREATE TABLE "FactorReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "factor" TEXT NOT NULL,
    "freq" TEXT NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL
);
CREATE INDEX "FactorReport_factor_idx" ON "FactorReport"("factor");
PRAGMA foreign_keys=ON;
