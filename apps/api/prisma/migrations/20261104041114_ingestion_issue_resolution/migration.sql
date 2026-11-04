-- CreateTable
CREATE TABLE "IngestionIssueResolution" (
    "issueId" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "evidence" JSONB,
    "before" JSONB,
    "after" JSONB,
    "marketRevision" INTEGER,
    "history" JSONB NOT NULL DEFAULT [],
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IngestionIssueResolution_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "IngestionIssue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "IngestionIssueResolution_status_updatedAt_idx" ON "IngestionIssueResolution"("status", "updatedAt");
