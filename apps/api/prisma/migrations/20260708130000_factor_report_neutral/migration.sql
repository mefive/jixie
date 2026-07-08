-- Add neutralization dimension to the factor-report cache (factor-to-strategy.md 3.4).
-- Existing rows default to 'none' (they were computed without neutralization).
ALTER TABLE "FactorReport" ADD COLUMN "neutral" TEXT NOT NULL DEFAULT 'none';
