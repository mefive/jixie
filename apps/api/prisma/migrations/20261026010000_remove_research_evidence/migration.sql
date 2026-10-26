-- DropIndex
DROP INDEX "ResearchExecutionInput_executionId_sequence_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ResearchExecutionInput";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Strategy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "lastResult" JSONB,
    "messages" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Strategy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Strategy" ("config", "createdAt", "id", "lastResult", "messages", "name", "updatedAt", "userId") SELECT "config", "createdAt", "id", "lastResult", "messages", "name", "updatedAt", "userId" FROM "Strategy";
DROP TABLE "Strategy";
ALTER TABLE "new_Strategy" RENAME TO "Strategy";
CREATE INDEX "Strategy_userId_updatedAt_idx" ON "Strategy"("userId", "updatedAt");
CREATE UNIQUE INDEX "Strategy_userId_name_key" ON "Strategy"("userId", "name");
CREATE TABLE "new_Factor" (
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
INSERT INTO "new_Factor" ("analysisKind", "approvedReportId", "archivedAt", "code", "codeHash", "createdAt", "descriptionEn", "descriptionZh", "id", "key", "language", "messages", "name", "publishedAt", "runtimeVersion", "status", "updatedAt", "userId") SELECT "analysisKind", "approvedReportId", "archivedAt", "code", "codeHash", "createdAt", "descriptionEn", "descriptionZh", "id", "key", "language", "messages", "name", "publishedAt", "runtimeVersion", "status", "updatedAt", "userId" FROM "Factor";
DROP TABLE "Factor";
ALTER TABLE "new_Factor" RENAME TO "Factor";
CREATE UNIQUE INDEX "Factor_approvedReportId_key" ON "Factor"("approvedReportId");
CREATE INDEX "Factor_userId_updatedAt_idx" ON "Factor"("userId", "updatedAt");
CREATE UNIQUE INDEX "Factor_userId_key_key" ON "Factor"("userId", "key");
CREATE TABLE "new_ResearchDocument" (
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
INSERT INTO "new_ResearchDocument" ("contentRevision", "conversationId", "createdAt", "embeddedRunKey", "id", "runtimeVersion", "updatedAt", "userId") SELECT "contentRevision", "conversationId", "createdAt", "embeddedRunKey", "id", "runtimeVersion", "updatedAt", "userId" FROM "ResearchDocument";
DROP TABLE "ResearchDocument";
ALTER TABLE "new_ResearchDocument" RENAME TO "ResearchDocument";
CREATE UNIQUE INDEX "ResearchDocument_conversationId_key" ON "ResearchDocument"("conversationId");
CREATE UNIQUE INDEX "ResearchDocument_embeddedRunKey_key" ON "ResearchDocument"("embeddedRunKey");
CREATE INDEX "ResearchDocument_userId_updatedAt_idx" ON "ResearchDocument"("userId", "updatedAt");
CREATE TABLE "new_ResearchCellExecution" (
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
INSERT INTO "new_ResearchCellExecution" ("cellChangeAttemptId", "cellId", "definitions", "documentId", "error", "finishedAt", "id", "output", "references", "researchExecutionId", "revision", "sourceCellId", "sourceKind", "sourcePosition", "startedAt", "status") SELECT "cellChangeAttemptId", "cellId", "definitions", "documentId", "error", "finishedAt", "id", "output", "references", "researchExecutionId", "revision", "sourceCellId", "sourceKind", "sourcePosition", "startedAt", "status" FROM "ResearchCellExecution";
DROP TABLE "ResearchCellExecution";
ALTER TABLE "new_ResearchCellExecution" RENAME TO "ResearchCellExecution";
CREATE INDEX "ResearchCellExecution_documentId_startedAt_idx" ON "ResearchCellExecution"("documentId", "startedAt");
CREATE INDEX "ResearchCellExecution_cellId_startedAt_idx" ON "ResearchCellExecution"("cellId", "startedAt");
CREATE INDEX "ResearchCellExecution_sourceCellId_startedAt_idx" ON "ResearchCellExecution"("sourceCellId", "startedAt");
CREATE INDEX "ResearchCellExecution_cellChangeAttemptId_startedAt_idx" ON "ResearchCellExecution"("cellChangeAttemptId", "startedAt");
CREATE INDEX "ResearchCellExecution_researchExecutionId_startedAt_idx" ON "ResearchCellExecution"("researchExecutionId", "startedAt");
CREATE TABLE "new_ResearchExecution" (
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
INSERT INTO "new_ResearchExecution" ("contentRevision", "documentId", "embeddedVersionId", "error", "errorCode", "finishedAt", "id", "requestId", "sequence", "startedAt", "status") SELECT "contentRevision", "documentId", "embeddedVersionId", "error", "errorCode", "finishedAt", "id", "requestId", "sequence", "startedAt", "status" FROM "ResearchExecution";
DROP TABLE "ResearchExecution";
ALTER TABLE "new_ResearchExecution" RENAME TO "ResearchExecution";
CREATE INDEX "ResearchExecution_embeddedVersionId_startedAt_idx" ON "ResearchExecution"("embeddedVersionId", "startedAt");
CREATE INDEX "ResearchExecution_documentId_startedAt_idx" ON "ResearchExecution"("documentId", "startedAt");
CREATE UNIQUE INDEX "ResearchExecution_embeddedVersionId_requestId_key" ON "ResearchExecution"("embeddedVersionId", "requestId");
CREATE UNIQUE INDEX "ResearchExecution_documentId_sequence_key" ON "ResearchExecution"("documentId", "sequence");
CREATE TABLE "new_ResearchArtifact" (
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
INSERT INTO "new_ResearchArtifact" ("byteSize", "createdAt", "data", "documentId", "height", "id", "kind", "mimeType", "sha256", "width") SELECT "byteSize", "createdAt", "data", "documentId", "height", "id", "kind", "mimeType", "sha256", "width" FROM "ResearchArtifact";
DROP TABLE "ResearchArtifact";
ALTER TABLE "new_ResearchArtifact" RENAME TO "ResearchArtifact";
CREATE INDEX "ResearchArtifact_documentId_createdAt_idx" ON "ResearchArtifact"("documentId", "createdAt");
CREATE INDEX "ResearchArtifact_sha256_idx" ON "ResearchArtifact"("sha256");
CREATE TABLE "new_ResearchEmbeddedAnalysisVersion" (
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
INSERT INTO "new_ResearchEmbeddedAnalysisVersion" ("analysisId", "createdAt", "documentId", "id", "inputScope", "number", "parameters", "parentVersionId", "revision", "source", "updatedAt") SELECT "analysisId", "createdAt", "documentId", "id", "inputScope", "number", "parameters", "parentVersionId", "revision", "source", "updatedAt" FROM "ResearchEmbeddedAnalysisVersion";
DROP TABLE "ResearchEmbeddedAnalysisVersion";
ALTER TABLE "new_ResearchEmbeddedAnalysisVersion" RENAME TO "ResearchEmbeddedAnalysisVersion";
CREATE UNIQUE INDEX "ResearchEmbeddedAnalysisVersion_documentId_key" ON "ResearchEmbeddedAnalysisVersion"("documentId");
CREATE UNIQUE INDEX "ResearchEmbeddedAnalysisVersion_analysisId_number_key" ON "ResearchEmbeddedAnalysisVersion"("analysisId", "number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

