-- AlterTable
ALTER TABLE "AgentConversation" ADD COLUMN "questionFactorKey" TEXT;

-- AlterTable
ALTER TABLE "AgentTurn" ADD COLUMN "contextSnapshot" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "AgentConversation_userId_questionFactorKey_key" ON "AgentConversation"("userId", "questionFactorKey");
