-- CreateTable
CREATE TABLE "ResearchEmbeddedAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "hostType" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "nextVersion" INTEGER NOT NULL DEFAULT 1,
    "activeRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchEmbeddedAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchEmbeddedAnalysisVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "parentVersionId" TEXT,
    "documentId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "inputScope" TEXT NOT NULL,
    "contextSnapshot" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "frozenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchEmbeddedAnalysisVersion_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ResearchEmbeddedAnalysis" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchEmbeddedAnalysisVersion_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "ResearchEmbeddedAnalysisVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResearchEmbeddedAnalysisVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchExecutionInput" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "responseJson" TEXT,
    "metadata" JSONB,
    "sha256" TEXT,
    "byteSize" INTEGER NOT NULL DEFAULT 0,
    "rowCount" INTEGER,
    "error" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" DATETIME,
    CONSTRAINT "ResearchExecutionInput_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ResearchExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "backtestReportId" TEXT,
    "strategyScanReportId" TEXT,
    "signalRunId" TEXT,
    "researchExecutionId" TEXT,
    "researchCuratorRunId" TEXT,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_factorReportId_fkey" FOREIGN KEY ("factorReportId") REFERENCES "FactorReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_backtestReportId_fkey" FOREIGN KEY ("backtestReportId") REFERENCES "BacktestReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_strategyScanReportId_fkey" FOREIGN KEY ("strategyScanReportId") REFERENCES "StrategyScanReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_signalRunId_fkey" FOREIGN KEY ("signalRunId") REFERENCES "SignalRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_researchExecutionId_fkey" FOREIGN KEY ("researchExecutionId") REFERENCES "ResearchExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_researchCuratorRunId_fkey" FOREIGN KEY ("researchCuratorRunId") REFERENCES "ResearchCuratorRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("backtestReportId", "createdAt", "error", "factorReportId", "finishedAt", "id", "key", "kind", "logs", "payload", "queuedAt", "researchCuratorRunId", "signalRunId", "startedAt", "status", "strategyScanReportId", "updatedAt", "userId") SELECT "backtestReportId", "createdAt", "error", "factorReportId", "finishedAt", "id", "key", "kind", "logs", "payload", "queuedAt", "researchCuratorRunId", "signalRunId", "startedAt", "status", "strategyScanReportId", "updatedAt", "userId" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE UNIQUE INDEX "Job_factorReportId_key" ON "Job"("factorReportId");
CREATE UNIQUE INDEX "Job_backtestReportId_key" ON "Job"("backtestReportId");
CREATE UNIQUE INDEX "Job_strategyScanReportId_key" ON "Job"("strategyScanReportId");
CREATE UNIQUE INDEX "Job_researchExecutionId_key" ON "Job"("researchExecutionId");
CREATE UNIQUE INDEX "Job_researchCuratorRunId_key" ON "Job"("researchCuratorRunId");
CREATE INDEX "Job_userId_kind_key_status_idx" ON "Job"("userId", "kind", "key", "status");
CREATE INDEX "Job_signalRunId_createdAt_idx" ON "Job"("signalRunId", "createdAt");
CREATE TABLE "new_ResearchExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "contentRevision" INTEGER NOT NULL,
    "runtimeVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "sourceHash" TEXT NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "dagSnapshot" JSONB NOT NULL,
    "executedCellIds" JSONB NOT NULL,
    "environmentFingerprint" TEXT,
    "error" TEXT,
    "displayName" TEXT,
    "tags" JSONB,
    "userNote" TEXT,
    "promotedAt" DATETIME,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "embeddedVersionId" TEXT,
    "requestId" TEXT,
    "parametersSnapshot" JSONB,
    "contextSnapshot" JSONB,
    "environmentSnapshot" JSONB,
    "errorCode" TEXT,
    CONSTRAINT "ResearchExecution_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchExecution_embeddedVersionId_fkey" FOREIGN KEY ("embeddedVersionId") REFERENCES "ResearchEmbeddedAnalysisVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ResearchExecution" ("contentRevision", "dagSnapshot", "displayName", "documentId", "environmentFingerprint", "error", "executedCellIds", "finishedAt", "id", "promotedAt", "runtimeVersion", "sequence", "sourceHash", "sourceSnapshot", "startedAt", "status", "tags", "title", "userNote") SELECT "contentRevision", "dagSnapshot", "displayName", "documentId", "environmentFingerprint", "error", "executedCellIds", "finishedAt", "id", "promotedAt", "runtimeVersion", "sequence", "sourceHash", "sourceSnapshot", "startedAt", "status", "tags", "title", "userNote" FROM "ResearchExecution";
DROP TABLE "ResearchExecution";
ALTER TABLE "new_ResearchExecution" RENAME TO "ResearchExecution";
CREATE INDEX "ResearchExecution_embeddedVersionId_startedAt_idx" ON "ResearchExecution"("embeddedVersionId", "startedAt");
CREATE INDEX "ResearchExecution_documentId_startedAt_idx" ON "ResearchExecution"("documentId", "startedAt");
CREATE INDEX "ResearchExecution_documentId_promotedAt_idx" ON "ResearchExecution"("documentId", "promotedAt");
CREATE UNIQUE INDEX "ResearchExecution_embeddedVersionId_requestId_key" ON "ResearchExecution"("embeddedVersionId", "requestId");
CREATE UNIQUE INDEX "ResearchExecution_documentId_sequence_key" ON "ResearchExecution"("documentId", "sequence");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ResearchEmbeddedAnalysis_activeRunId_key" ON "ResearchEmbeddedAnalysis"("activeRunId");

-- CreateIndex
CREATE INDEX "ResearchEmbeddedAnalysis_userId_hostType_hostId_updatedAt_idx" ON "ResearchEmbeddedAnalysis"("userId", "hostType", "hostId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchEmbeddedAnalysisVersion_documentId_key" ON "ResearchEmbeddedAnalysisVersion"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchEmbeddedAnalysisVersion_analysisId_number_key" ON "ResearchEmbeddedAnalysisVersion"("analysisId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchExecutionInput_executionId_sequence_key" ON "ResearchExecutionInput"("executionId", "sequence");
