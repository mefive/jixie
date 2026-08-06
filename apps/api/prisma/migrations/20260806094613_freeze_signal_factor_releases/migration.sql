-- AlterTable
ALTER TABLE "SignalRun" ADD COLUMN "factorReleases" JSONB;

-- AlterTable
ALTER TABLE "StrategyDeployment" ADD COLUMN "factorReleases" JSONB;
