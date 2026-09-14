-- AlterTable
ALTER TABLE "ResearchDocument" ADD COLUMN "embeddedRunKey" TEXT;
ALTER TABLE "ResearchDocument" ADD COLUMN "embeddedSource" JSONB;

-- AlterTable
ALTER TABLE "ResearchCellExecution" ADD COLUMN "inputSnapshot" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "ResearchDocument_embeddedRunKey_key" ON "ResearchDocument"("embeddedRunKey");

