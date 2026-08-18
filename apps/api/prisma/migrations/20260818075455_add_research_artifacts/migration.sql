-- CreateTable
CREATE TABLE "ResearchArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchArtifact_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ResearchDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchArtifact_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ResearchCellExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ResearchArtifact_documentId_createdAt_idx" ON "ResearchArtifact"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchArtifact_executionId_idx" ON "ResearchArtifact"("executionId");

-- CreateIndex
CREATE INDEX "ResearchArtifact_sha256_idx" ON "ResearchArtifact"("sha256");
