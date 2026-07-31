-- AlterTable
ALTER TABLE "SignalRun" ADD COLUMN "modelPositions" JSONB;

-- CreateTable
CREATE TABLE "SignalExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "signalRunId" TEXT NOT NULL,
    "signalIndex" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "requestedShares" REAL NOT NULL,
    "refPrice" REAL NOT NULL,
    "refAmount" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "targetWeight" REAL,
    "simulatedStatus" TEXT NOT NULL DEFAULT 'pending',
    "simulatedShares" REAL,
    "simulatedPrice" REAL,
    "simulatedFee" REAL,
    "simulatedSlippage" REAL,
    "simulatedReason" TEXT,
    "actualStatus" TEXT NOT NULL DEFAULT 'pending',
    "actualShares" REAL,
    "actualPrice" REAL,
    "actualFee" REAL,
    "actualReason" TEXT,
    "actualNote" TEXT,
    "actualRecordedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SignalExecution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SignalExecution_signalRunId_fkey" FOREIGN KEY ("signalRunId") REFERENCES "SignalRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StrategyAccountSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "cash" REAL NOT NULL,
    "marketValue" REAL NOT NULL,
    "equity" REAL NOT NULL,
    "positions" JSONB NOT NULL,
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "sourceRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StrategyAccountSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StrategyAccountSnapshot_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "StrategyDeployment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SignalExecution_userId_actualStatus_idx" ON "SignalExecution"("userId", "actualStatus");

-- CreateIndex
CREATE INDEX "SignalExecution_code_createdAt_idx" ON "SignalExecution"("code", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SignalExecution_signalRunId_signalIndex_key" ON "SignalExecution"("signalRunId", "signalIndex");

-- CreateIndex
CREATE INDEX "StrategyAccountSnapshot_userId_kind_tradeDate_idx" ON "StrategyAccountSnapshot"("userId", "kind", "tradeDate");

-- CreateIndex
CREATE INDEX "StrategyAccountSnapshot_deploymentId_kind_isBaseline_idx" ON "StrategyAccountSnapshot"("deploymentId", "kind", "isBaseline");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyAccountSnapshot_deploymentId_kind_tradeDate_key" ON "StrategyAccountSnapshot"("deploymentId", "kind", "tradeDate");
