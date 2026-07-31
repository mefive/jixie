-- CreateTable
CREATE TABLE "MaintenanceRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "startDate" TEXT,
    "endDate" TEXT,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "summary" JSONB,
    "error" TEXT,
    "heartbeatAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MaintenanceState" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "dailyPublishedThrough" TEXT,
    "weeklySyncedThrough" TEXT,
    "dataRevision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "MaintenanceRun_status_updatedAt_idx" ON "MaintenanceRun"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceRun_kind_targetKey_key" ON "MaintenanceRun"("kind", "targetKey");
