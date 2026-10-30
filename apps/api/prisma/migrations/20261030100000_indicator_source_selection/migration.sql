-- AlterTable
ALTER TABLE "FinaIndicator" ADD COLUMN "sourceTsCode" TEXT;

-- AlterTable
ALTER TABLE "FinaIndicatorVersion" ADD COLUMN "sourceTsCode" TEXT;
ALTER TABLE "FinaIndicatorVersion" ADD COLUMN "updateFlag" TEXT;

