import { getDatabase } from '#infra/database/prisma.js';
import { stockMarketRanges } from '../instruments/market-range.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';

/**
 * 上市截止日只筛选证券，不裁剪已纳入公司的上市前报告。
 *
 * The listing cutoff selects securities without truncating their pre-listing reports.
 */
export async function financialStockCodes(targetDate: string): Promise<Set<string>> {
  const stocks = await getDatabase().stockBasic.findMany();
  const ranges = stockMarketRanges(stocks);

  return new Set(
    stocks
      .map((row) => canonicalStockCode(row.tsCode))
      .filter((code) => {
        const start = ranges.get(code)?.startDate;

        return !start || start <= targetDate;
      }),
  );
}
