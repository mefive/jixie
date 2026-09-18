import { validateIndexDate, type IndexDateQuality } from '#market/indices/daily-quality.js';
import { validateStockDate, type StockDateQuality } from '#market/stocks/daily-quality.js';

export interface RawDateQuality extends StockDateQuality, IndexDateQuality {
  tradeDate: string;
}

/** Publication policy selects freshness; Market validates each dataset. */
export async function validateRawMarketDate(tradeDate: string): Promise<RawDateQuality> {
  const maximumAge = Number(process.env.MAINTENANCE_INDEX_WEIGHT_MAX_AGE_DAYS);
  const maximumIndexWeightAgeDays =
    Number.isInteger(maximumAge) && maximumAge > 0 ? maximumAge : 190;
  const stocks = await validateStockDate(tradeDate);
  const indices = await validateIndexDate(tradeDate, maximumIndexWeightAgeDays);
  return { tradeDate, ...stocks, ...indices };
}
