-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StrategyDeployment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "backtestReportId" TEXT,
    "activeReportId" TEXT,
    "strategyName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "factorDependencies" JSONB,
    "codeHash" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "deployedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StrategyDeployment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StrategyDeployment_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "StrategyDeployment_backtestReportId_fkey" FOREIGN KEY ("backtestReportId") REFERENCES "BacktestReport" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);
INSERT INTO "new_StrategyDeployment" ("codeHash", "config", "createdAt", "deployedAt", "factorDependencies", "id", "locale", "status", "stoppedAt", "strategyId", "strategyName", "updatedAt", "userId") SELECT "codeHash", "config", "createdAt", "deployedAt", "factorDependencies", "id", "locale", "status", "stoppedAt", "strategyId", "strategyName", "updatedAt", "userId" FROM "StrategyDeployment";
DROP TABLE "StrategyDeployment";
ALTER TABLE "new_StrategyDeployment" RENAME TO "StrategyDeployment";
CREATE UNIQUE INDEX "StrategyDeployment_activeReportId_key" ON "StrategyDeployment"("activeReportId");
CREATE INDEX "StrategyDeployment_userId_status_idx" ON "StrategyDeployment"("userId", "status");
CREATE INDEX "StrategyDeployment_strategyId_status_idx" ON "StrategyDeployment"("strategyId", "status");
CREATE INDEX "StrategyDeployment_backtestReportId_idx" ON "StrategyDeployment"("backtestReportId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
