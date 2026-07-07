-- Wave-1 fina_indicator column expansion (docs/design/data-expansion.md):
-- 毛利率/净利率/资产负债率/ROA/营收与净利同比/经营现金流比,PIT via annDate as before.
ALTER TABLE "FinaIndicator" ADD COLUMN "roa" REAL;
ALTER TABLE "FinaIndicator" ADD COLUMN "grossprofitMargin" REAL;
ALTER TABLE "FinaIndicator" ADD COLUMN "netprofitMargin" REAL;
ALTER TABLE "FinaIndicator" ADD COLUMN "debtToAssets" REAL;
ALTER TABLE "FinaIndicator" ADD COLUMN "orYoy" REAL;
ALTER TABLE "FinaIndicator" ADD COLUMN "netprofitYoy" REAL;
ALTER TABLE "FinaIndicator" ADD COLUMN "ocfToProfit" REAL;
