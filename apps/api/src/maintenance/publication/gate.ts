import { validateIndexDate, type IndexDateQuality } from '#market/indices/daily-quality.js';
import { validateStockDate, type StockDateQuality } from '#market/stocks/daily-quality.js';

/**
 * 记录单个原始市场日期的质量状态，供发布门禁判断。
 *
 * Describe raw market-date quality for publication gating.
 */
export interface RawDateQuality extends StockDateQuality, IndexDateQuality {
  tradeDate: string;
}

/**
 * 由发布策略选择新鲜度要求，再委托 Market 校验各数据集。
 *
 * Publication policy selects freshness; Market validates each dataset.
 */
export async function validateRawMarketDate(tradeDate: string): Promise<RawDateQuality> {
  const maximumAge = Number(process.env.MAINTENANCE_INDEX_WEIGHT_MAX_AGE_DAYS);
  const maximumIndexWeightAgeDays =
    Number.isInteger(maximumAge) && maximumAge > 0 ? maximumAge : 190;
  const stocks = await validateStockDate(tradeDate);
  const indices = await validateIndexDate(tradeDate, maximumIndexWeightAgeDays);
  return { tradeDate, ...stocks, ...indices };
}
