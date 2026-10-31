-- AlterTable
ALTER TABLE "StockNameHistory" ADD COLUMN "sourceTsCode" TEXT;

-- AlterTable
ALTER TABLE "Daily" ADD COLUMN "sourceTsCode" TEXT;

-- AlterTable
ALTER TABLE "AdjFactor" ADD COLUMN "sourceTsCode" TEXT;

-- AlterTable
ALTER TABLE "StkLimit" ADD COLUMN "sourceTsCode" TEXT;

-- AlterTable
ALTER TABLE "DailyBasic" ADD COLUMN "sourceTsCode" TEXT;

-- AlterTable
ALTER TABLE "FinancialIncomeStatement" ADD COLUMN "sourceTsCode" TEXT;

-- AlterTable
ALTER TABLE "FinancialBalanceSheet" ADD COLUMN "sourceTsCode" TEXT;

-- AlterTable
ALTER TABLE "FinancialCashFlowStatement" ADD COLUMN "sourceTsCode" TEXT;

-- AlterTable
ALTER TABLE "Dividend" ADD COLUMN "sourceTsCode" TEXT;

-- AlterTable
ALTER TABLE "IndexWeight" ADD COLUMN "sourceTsCode" TEXT;
