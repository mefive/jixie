-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "Job_userId_kind_key_status_idx" ON "Job"("userId", "kind", "key", "status");

-- FactorReport now per-user. Old rows (id=`factor|freq|start|end`, no userId) are an obsolete cache →
-- dropped, not migrated; reports regenerate per user on demand.
PRAGMA foreign_keys=OFF;
DROP TABLE "FactorReport";
CREATE TABLE "FactorReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "factor" TEXT NOT NULL,
    "freq" TEXT NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL
);
CREATE INDEX "FactorReport_userId_factor_idx" ON "FactorReport"("userId", "factor");
PRAGMA foreign_keys=ON;
