-- DropIndex
DROP INDEX "IngestionBatch_runId_dataset_scope_period_key";

-- CreateIndex
CREATE INDEX "IngestionBatch_runId_dataset_scope_period_startedAt_idx" ON "IngestionBatch"("runId", "dataset", "scope", "period", "startedAt");
