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
  const stocks = await validateStockDate(tradeDate);
  const indices = await validateIndexDate(tradeDate, indexWeightMaximumAgeDays());

  return { tradeDate, ...stocks, ...indices };
}

/** 成分历史下载与校验共用发布新鲜度策略。 / Share publication freshness policy between membership preparation and validation. */
export function indexWeightMaximumAgeDays(): number {
  const maximumAge = Number(process.env.MAINTENANCE_INDEX_WEIGHT_MAX_AGE_DAYS);

  return Number.isInteger(maximumAge) && maximumAge > 0 ? maximumAge : 190;
}
