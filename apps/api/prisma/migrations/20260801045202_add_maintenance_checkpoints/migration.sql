-- CreateTable
CREATE TABLE "MaintenanceCheckpoint" (
    "runId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "completedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("runId", "stage", "itemKey")
);

-- CreateIndex
CREATE INDEX "MaintenanceCheckpoint_runId_stage_idx" ON "MaintenanceCheckpoint"("runId", "stage");
