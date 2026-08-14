-- CreateTable
CREATE TABLE "ResearchCuratorRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "cursorFrom" DATETIME,
    "cursorTo" DATETIME NOT NULL,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "findingsCreated" INTEGER NOT NULL DEFAULT 0,
    "duplicatesSkipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchCuratorRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchCuratorFinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "verification" JSONB NOT NULL,
    "confidence" REAL NOT NULL,
    "expectedValue" TEXT NOT NULL,
    "changeSurface" JSONB NOT NULL,
    "suggestedAction" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "disposition" TEXT NOT NULL DEFAULT 'pending',
    "dispositionNote" TEXT,
    "disposedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchCuratorFinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchCuratorFinding_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchCuratorRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB,
    "error" TEXT,
    "logs" TEXT,
    "factorReportId" TEXT,
    "strategyScanReportId" TEXT,
    "signalRunId" TEXT,
    "researchCuratorRunId" TEXT,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_factorReportId_fkey" FOREIGN KEY ("factorReportId") REFERENCES "FactorReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_strategyScanReportId_fkey" FOREIGN KEY ("strategyScanReportId") REFERENCES "StrategyScanReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_signalRunId_fkey" FOREIGN KEY ("signalRunId") REFERENCES "SignalRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_researchCuratorRunId_fkey" FOREIGN KEY ("researchCuratorRunId") REFERENCES "ResearchCuratorRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("createdAt", "error", "factorReportId", "finishedAt", "id", "key", "kind", "logs", "payload", "queuedAt", "signalRunId", "startedAt", "status", "strategyScanReportId", "updatedAt", "userId") SELECT "createdAt", "error", "factorReportId", "finishedAt", "id", "key", "kind", "logs", "payload", "queuedAt", "signalRunId", "startedAt", "status", "strategyScanReportId", "updatedAt", "userId" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE UNIQUE INDEX "Job_factorReportId_key" ON "Job"("factorReportId");
CREATE UNIQUE INDEX "Job_strategyScanReportId_key" ON "Job"("strategyScanReportId");
CREATE UNIQUE INDEX "Job_researchCuratorRunId_key" ON "Job"("researchCuratorRunId");
CREATE INDEX "Job_userId_kind_key_status_idx" ON "Job"("userId", "kind", "key", "status");
CREATE INDEX "Job_signalRunId_createdAt_idx" ON "Job"("signalRunId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ResearchCuratorRun_userId_createdAt_idx" ON "ResearchCuratorRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchCuratorRun_userId_status_createdAt_idx" ON "ResearchCuratorRun"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchCuratorFinding_userId_disposition_createdAt_idx" ON "ResearchCuratorFinding"("userId", "disposition", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchCuratorFinding_runId_createdAt_idx" ON "ResearchCuratorFinding"("runId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchCuratorFinding_userId_fingerprint_key" ON "ResearchCuratorFinding"("userId", "fingerprint");
