-- CreateTable
CREATE TABLE "ResearchAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "studyId" TEXT,
    "parentRunId" TEXT,
    "sourceTurnId" TEXT,
    "sourceStepId" TEXT,
    "origin" TEXT NOT NULL,
    "plan" JSONB,
    "planHash" TEXT,
    "arguments" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchAttempt_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchAttempt_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "ResearchStudy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchAttempt_parentRunId_fkey" FOREIGN KEY ("parentRunId") REFERENCES "ResearchRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResearchAttempt_sourceTurnId_fkey" FOREIGN KEY ("sourceTurnId") REFERENCES "AgentTurn" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ResearchAttempt_sourceStepId_key" ON "ResearchAttempt"("sourceStepId");

-- CreateIndex
CREATE INDEX "ResearchAttempt_studyId_createdAt_idx" ON "ResearchAttempt"("studyId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchAttempt_conversationId_createdAt_idx" ON "ResearchAttempt"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchAttempt_sourceTurnId_idx" ON "ResearchAttempt"("sourceTurnId");

-- CreateIndex
CREATE INDEX "ResearchAttempt_parentRunId_idx" ON "ResearchAttempt"("parentRunId");
