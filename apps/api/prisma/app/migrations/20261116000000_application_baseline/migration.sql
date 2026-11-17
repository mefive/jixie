-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InviteCode" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'unused',
    "usedByEmail" TEXT,
    "usedAt" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FactorReport" (
    "marketVersionId" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "factor" TEXT NOT NULL,
    "status" TEXT,
    "analysisKind" TEXT NOT NULL DEFAULT 'cross_sectional',
    "language" TEXT NOT NULL DEFAULT 'typescript',
    "runtimeVersion" TEXT NOT NULL DEFAULT 'ts-v1',
    "freq" TEXT NOT NULL,
    "neutral" TEXT NOT NULL DEFAULT 'none',
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "specJson" TEXT,
    "variantKey" TEXT,
    "factorCodeSnapshot" TEXT,
    "factorCodeHash" TEXT,
    "dataRevision" TEXT,
    "payload" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Job" (
    "marketVersionId" TEXT,
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
    "researchExecutionId" TEXT,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_factorReportId_fkey" FOREIGN KEY ("factorReportId") REFERENCES "FactorReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_backtestReportId_fkey" FOREIGN KEY ("backtestReportId") REFERENCES "BacktestReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_strategyScanReportId_fkey" FOREIGN KEY ("strategyScanReportId") REFERENCES "StrategyScanReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_researchExecutionId_fkey" FOREIGN KEY ("researchExecutionId") REFERENCES "ResearchExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailLoginChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "inviteCode" TEXT,
    "codeHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "messages" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Strategy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BacktestReport" (
    "marketVersionId" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "strategyName" TEXT NOT NULL,
    "status" TEXT,
    "config" JSONB NOT NULL,
    "inputSignature" TEXT,
    "payload" JSONB,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedAt" DATETIME,
    CONSTRAINT "BacktestReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BacktestReport_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StrategyScanReport" (
    "marketVersionId" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "strategyName" TEXT NOT NULL,
    "status" TEXT,
    "config" JSONB NOT NULL,
    "spec" JSONB NOT NULL,
    "inputSignature" TEXT,
    "dataCutoff" TEXT,
    "payload" JSONB,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StrategyScanReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StrategyScanReport_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Factor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "analysisKind" TEXT NOT NULL DEFAULT 'cross_sectional',
    "language" TEXT NOT NULL DEFAULT 'typescript',
    "runtimeVersion" TEXT NOT NULL DEFAULT 'ts-v1',
    "descriptionZh" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL,
    "messages" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvedReportId" TEXT,
    "codeHash" TEXT,
    "publishedAt" DATETIME,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Factor_approvedReportId_fkey" FOREIGN KEY ("approvedReportId") REFERENCES "FactorReport" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "questionFactorKey" TEXT,
    "title" TEXT,
    "strategyId" TEXT,
    "factorId" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentConversation_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentConversation_factorId_fkey" FOREIGN KEY ("factorId") REFERENCES "Factor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "parts" JSONB NOT NULL,
    "sequence" INTEGER NOT NULL,
    "turnId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentMessage_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "AgentTurn" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentTurn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "trace" JSONB NOT NULL,
    "contextSnapshot" JSONB,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "AgentTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "runtimeVersion" TEXT NOT NULL DEFAULT 'research-py-v1',
    "contentRevision" INTEGER NOT NULL DEFAULT 1,
    "embeddedRunKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchDocument_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchCell" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "config" JSONB,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "definitions" JSONB NOT NULL,
    "references" JSONB NOT NULL,
    "dependencyIssues" JSONB NOT NULL DEFAULT [],
    "output" JSONB,
    "lastExecutedRevision" INTEGER,
    "lastExecutedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchCell_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchCellExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "cellId" TEXT,
    "sourceCellId" TEXT,
    "sourcePosition" INTEGER,
    "sourceKind" TEXT,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "definitions" JSONB NOT NULL,
    "references" JSONB NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "cellChangeAttemptId" TEXT,
    "researchExecutionId" TEXT,
    CONSTRAINT "ResearchCellExecution_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellExecution_cellId_fkey" FOREIGN KEY ("cellId") REFERENCES "ResearchCell" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellExecution_cellChangeAttemptId_fkey" FOREIGN KEY ("cellChangeAttemptId") REFERENCES "ResearchCellChangeAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellExecution_researchExecutionId_fkey" FOREIGN KEY ("researchExecutionId") REFERENCES "ResearchExecution" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchExecution" (
    "marketVersionId" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "contentRevision" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "embeddedVersionId" TEXT,
    "requestId" TEXT,
    "errorCode" TEXT,
    CONSTRAINT "ResearchExecution_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchExecution_embeddedVersionId_fkey" FOREIGN KEY ("embeddedVersionId") REFERENCES "ResearchEmbeddedAnalysisVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchArtifact_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchCellChangeProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "sourceTurnId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "sourcePartIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "expectedDocumentUpdatedAt" DATETIME NOT NULL,
    "expectedDocumentContentRevision" INTEGER,
    "appliedDocumentContentRevision" INTEGER,
    "reviewSessionId" TEXT,
    "reviewSequence" INTEGER,
    "reviewStatus" TEXT,
    "reviewIsLatest" BOOLEAN NOT NULL DEFAULT false,
    "reviewResolvedAt" DATETIME,
    "operations" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "conflict" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "ResearchCellChangeProposal_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellChangeProposal_sourceTurnId_fkey" FOREIGN KEY ("sourceTurnId") REFERENCES "AgentTurn" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellChangeProposal_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "AgentMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchClarification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "sourceTurnId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "sourcePartIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "answer" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" DATETIME,
    CONSTRAINT "ResearchClarification_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchClarification_sourceTurnId_fkey" FOREIGN KEY ("sourceTurnId") REFERENCES "AgentTurn" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchClarification_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "AgentMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchCellChangeAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "contentRevision" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "rootCellIds" JSONB NOT NULL,
    "plannedCellIds" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "explanationTurnId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "ResearchCellChangeAttempt_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchCellChangeAttempt_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ResearchCellChangeProposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TushareCapabilityProbe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogVersion" INTEGER NOT NULL,
    "apiName" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "probeDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "fields" JSONB NOT NULL,
    "historyField" TEXT,
    "historyStart" TEXT,
    "historyEnd" TEXT,
    "probeCoverage" TEXT,
    "errorCode" INTEGER,
    "errorMessage" TEXT,
    "probedAt" DATETIME NOT NULL
);

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
    "reportId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchEmbeddedAnalysisVersion_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ResearchEmbeddedAnalysis" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchEmbeddedAnalysisVersion_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "ResearchEmbeddedAnalysisVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResearchEmbeddedAnalysisVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentCodeChangeProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sourceTurnId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "baseIdentity" TEXT NOT NULL,
    "beforeCode" TEXT NOT NULL,
    "afterCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    CONSTRAINT "AgentCodeChangeProposal_sourceTurnId_fkey" FOREIGN KEY ("sourceTurnId") REFERENCES "AgentTurn" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentCodeChangeProposal_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "AgentMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketVersion" (
    "retained" BOOLEAN NOT NULL DEFAULT false,
    "historyVersionId" TEXT,
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "targetDate" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" DATETIME,
    "finishedAt" DATETIME,
    "rejectionReason" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "parentVersionId" TEXT,
    "parentSequence" INTEGER NOT NULL,
    "selectionVersion" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "activeSlot" INTEGER,
    "operation" TEXT,
    "candidateVersion" TEXT,
    "publishedAt" DATETIME,
    "publishedRevision" INTEGER
);

-- CreateTable
CREATE TABLE "MarketPublication" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "currentVersionId" TEXT,
    "previousVersionId" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "selectionVersion" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "MarketSelectionEdit" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "assetType" TEXT NOT NULL,
    "added" JSONB NOT NULL,
    "removed" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MarketRollback" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fromVersionId" TEXT NOT NULL,
    "toVersionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "InviteCode_status_idx" ON "InviteCode"("status");

-- CreateIndex
CREATE INDEX "FactorReport_userId_factor_createdAt_idx" ON "FactorReport"("userId", "factor", "createdAt");

-- CreateIndex
CREATE INDEX "FactorReport_userId_variantKey_idx" ON "FactorReport"("userId", "variantKey");

-- CreateIndex
CREATE UNIQUE INDEX "Job_factorReportId_key" ON "Job"("factorReportId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_backtestReportId_key" ON "Job"("backtestReportId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_strategyScanReportId_key" ON "Job"("strategyScanReportId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_researchExecutionId_key" ON "Job"("researchExecutionId");

-- CreateIndex
CREATE INDEX "Job_userId_kind_key_status_idx" ON "Job"("userId", "kind", "key", "status");

-- CreateIndex
CREATE INDEX "EmailLoginChallenge_email_expiresAt_idx" ON "EmailLoginChallenge"("email", "expiresAt");

-- CreateIndex
CREATE INDEX "Strategy_userId_updatedAt_idx" ON "Strategy"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Strategy_userId_name_key" ON "Strategy"("userId", "name");

-- CreateIndex
CREATE INDEX "BacktestReport_userId_strategyId_createdAt_idx" ON "BacktestReport"("userId", "strategyId", "createdAt");

-- CreateIndex
CREATE INDEX "BacktestReport_userId_status_createdAt_idx" ON "BacktestReport"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "StrategyScanReport_userId_strategyId_createdAt_idx" ON "StrategyScanReport"("userId", "strategyId", "createdAt");

-- CreateIndex
CREATE INDEX "StrategyScanReport_userId_status_idx" ON "StrategyScanReport"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Factor_approvedReportId_key" ON "Factor"("approvedReportId");

-- CreateIndex
CREATE INDEX "Factor_userId_updatedAt_idx" ON "Factor"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Factor_userId_key_key" ON "Factor"("userId", "key");

-- CreateIndex
CREATE INDEX "AgentConversation_userId_updatedAt_idx" ON "AgentConversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentConversation_userId_surface_updatedAt_idx" ON "AgentConversation"("userId", "surface", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentConversation_strategyId_idx" ON "AgentConversation"("strategyId");

-- CreateIndex
CREATE INDEX "AgentConversation_factorId_idx" ON "AgentConversation"("factorId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentConversation_userId_questionFactorKey_key" ON "AgentConversation"("userId", "questionFactorKey");

-- CreateIndex
CREATE INDEX "AgentMessage_conversationId_createdAt_idx" ON "AgentMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentMessage_turnId_idx" ON "AgentMessage"("turnId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMessage_conversationId_sequence_key" ON "AgentMessage"("conversationId", "sequence");

-- CreateIndex
CREATE INDEX "AgentTurn_conversationId_startedAt_idx" ON "AgentTurn"("conversationId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentTurn_status_startedAt_idx" ON "AgentTurn"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchDocument_conversationId_key" ON "ResearchDocument"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchDocument_embeddedRunKey_key" ON "ResearchDocument"("embeddedRunKey");

-- CreateIndex
CREATE INDEX "ResearchDocument_userId_updatedAt_idx" ON "ResearchDocument"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ResearchCell_documentId_updatedAt_idx" ON "ResearchCell"("documentId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchCell_documentId_position_key" ON "ResearchCell"("documentId", "position");

-- CreateIndex
CREATE INDEX "ResearchCellExecution_documentId_startedAt_idx" ON "ResearchCellExecution"("documentId", "startedAt");

-- CreateIndex
CREATE INDEX "ResearchCellExecution_cellId_startedAt_idx" ON "ResearchCellExecution"("cellId", "startedAt");

-- CreateIndex
CREATE INDEX "ResearchCellExecution_sourceCellId_startedAt_idx" ON "ResearchCellExecution"("sourceCellId", "startedAt");

-- CreateIndex
CREATE INDEX "ResearchCellExecution_cellChangeAttemptId_startedAt_idx" ON "ResearchCellExecution"("cellChangeAttemptId", "startedAt");

-- CreateIndex
CREATE INDEX "ResearchCellExecution_researchExecutionId_startedAt_idx" ON "ResearchCellExecution"("researchExecutionId", "startedAt");

-- CreateIndex
CREATE INDEX "ResearchExecution_embeddedVersionId_startedAt_idx" ON "ResearchExecution"("embeddedVersionId", "startedAt");

-- CreateIndex
CREATE INDEX "ResearchExecution_documentId_startedAt_idx" ON "ResearchExecution"("documentId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchExecution_embeddedVersionId_requestId_key" ON "ResearchExecution"("embeddedVersionId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchExecution_documentId_sequence_key" ON "ResearchExecution"("documentId", "sequence");

-- CreateIndex
CREATE INDEX "ResearchArtifact_documentId_createdAt_idx" ON "ResearchArtifact"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchArtifact_sha256_idx" ON "ResearchArtifact"("sha256");

-- CreateIndex
CREATE INDEX "ResearchCellChangeProposal_documentId_status_createdAt_idx" ON "ResearchCellChangeProposal"("documentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchCellChangeProposal_documentId_reviewStatus_createdAt_idx" ON "ResearchCellChangeProposal"("documentId", "reviewStatus", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchCellChangeProposal_reviewSessionId_reviewSequence_idx" ON "ResearchCellChangeProposal"("reviewSessionId", "reviewSequence");

-- CreateIndex
CREATE INDEX "ResearchCellChangeProposal_sourceTurnId_idx" ON "ResearchCellChangeProposal"("sourceTurnId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchCellChangeProposal_sourceMessageId_sourcePartIndex_key" ON "ResearchCellChangeProposal"("sourceMessageId", "sourcePartIndex");

-- CreateIndex
CREATE INDEX "ResearchClarification_documentId_status_createdAt_idx" ON "ResearchClarification"("documentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchClarification_sourceTurnId_idx" ON "ResearchClarification"("sourceTurnId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchClarification_sourceMessageId_sourcePartIndex_key" ON "ResearchClarification"("sourceMessageId", "sourcePartIndex");

-- CreateIndex
CREATE INDEX "ResearchCellChangeAttempt_documentId_startedAt_idx" ON "ResearchCellChangeAttempt"("documentId", "startedAt");

-- CreateIndex
CREATE INDEX "ResearchCellChangeAttempt_proposalId_startedAt_idx" ON "ResearchCellChangeAttempt"("proposalId", "startedAt");

-- CreateIndex
CREATE INDEX "TushareCapabilityProbe_apiName_probedAt_idx" ON "TushareCapabilityProbe"("apiName", "probedAt");

-- CreateIndex
CREATE INDEX "TushareCapabilityProbe_probedAt_idx" ON "TushareCapabilityProbe"("probedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchEmbeddedAnalysis_activeRunId_key" ON "ResearchEmbeddedAnalysis"("activeRunId");

-- CreateIndex
CREATE INDEX "ResearchEmbeddedAnalysis_userId_hostType_hostId_updatedAt_idx" ON "ResearchEmbeddedAnalysis"("userId", "hostType", "hostId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchEmbeddedAnalysisVersion_documentId_key" ON "ResearchEmbeddedAnalysisVersion"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchEmbeddedAnalysisVersion_analysisId_number_key" ON "ResearchEmbeddedAnalysisVersion"("analysisId", "number");

-- CreateIndex
CREATE INDEX "AgentCodeChangeProposal_userId_surface_entityId_createdAt_idx" ON "AgentCodeChangeProposal"("userId", "surface", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCodeChangeProposal_sourceTurnId_key" ON "AgentCodeChangeProposal"("sourceTurnId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketVersion_runId_key" ON "MarketVersion"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketVersion_activeSlot_key" ON "MarketVersion"("activeSlot");
