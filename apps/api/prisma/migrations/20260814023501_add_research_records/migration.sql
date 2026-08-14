-- CreateTable
CREATE TABLE "ResearchStudy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "question" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchStudy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchStudy_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studyId" TEXT NOT NULL,
    "parentRunId" TEXT,
    "sourceTurnId" TEXT,
    "sourceMessageId" TEXT,
    "sourcePartIndex" INTEGER,
    "sequence" INTEGER NOT NULL,
    "origin" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "protocolVersion" INTEGER NOT NULL,
    "plan" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "planHash" TEXT NOT NULL,
    "resultHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchRun_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "ResearchStudy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchRun_parentRunId_fkey" FOREIGN KEY ("parentRunId") REFERENCES "ResearchRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResearchRun_sourceTurnId_fkey" FOREIGN KEY ("sourceTurnId") REFERENCES "AgentTurn" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResearchRun_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "AgentMessage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ResearchStudy_userId_updatedAt_idx" ON "ResearchStudy"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ResearchStudy_conversationId_updatedAt_idx" ON "ResearchStudy"("conversationId", "updatedAt");

-- CreateIndex
CREATE INDEX "ResearchRun_sourceTurnId_idx" ON "ResearchRun"("sourceTurnId");

-- CreateIndex
CREATE INDEX "ResearchRun_sourceMessageId_idx" ON "ResearchRun"("sourceMessageId");

-- CreateIndex
CREATE INDEX "ResearchRun_parentRunId_idx" ON "ResearchRun"("parentRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchRun_studyId_sequence_key" ON "ResearchRun"("studyId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchRun_sourceMessageId_sourcePartIndex_key" ON "ResearchRun"("sourceMessageId", "sourcePartIndex");
