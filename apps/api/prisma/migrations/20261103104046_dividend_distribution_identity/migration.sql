-- AlterTable
ALTER TABLE "Dividend" ADD COLUMN "distributionKind" TEXT;
ALTER TABLE "Dividend" ADD COLUMN "implementationAnnouncementDate" TEXT;
ALTER TABLE "Dividend" ADD COLUMN "payDate" TEXT;
ALTER TABLE "Dividend" ADD COLUMN "recordDate" TEXT;
ALTER TABLE "Dividend" ADD COLUMN "shareListingDate" TEXT;
ALTER TABLE "Dividend" ADD COLUMN "stockBonusRate" REAL;
ALTER TABLE "Dividend" ADD COLUMN "stockCapitalizationRate" REAL;
ALTER TABLE "Dividend" ADD COLUMN "stockDividend" REAL;
