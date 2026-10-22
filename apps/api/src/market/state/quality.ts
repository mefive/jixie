import { getDatabase } from '#infra/database/prisma.js';
import { allMarketIndicatorScope, type DerivedMarketScope } from './scope.js';

/**
 * 描述派生状态区间完整性，供发布门禁。
 *
 * Describe derived-state interval completeness for publication gates.
 */
export interface DerivedRangeQuality {
  startDate: string;
  endDate: string;
  marketDates: number;
  indexRows: number;
  industryRows: number;
}

/**
 * 检查派生市场状态范围是否完整，供维护发布门禁。
 *
 * Validate derived market-state coverage for publication gating.
 */
export async function validateDerivedMarketRange(
  startDate: string,
  endDate: string,
  expectedDates: string[],
  scope: DerivedMarketScope = allMarketIndicatorScope(),
): Promise<DerivedRangeQuality> {
  const [marketRows, indexRows, industryRows, indexWeightCoverage] = await Promise.all([
    getDatabase().marketIndicator.findMany({
      where: { tradeDate: { gte: startDate, lte: endDate } },
      select: {
        tradeDate: true,
        advanceRatio: true,
        aboveMa20Ratio: true,
        aboveMa60Ratio: true,
      },
    }),
    getDatabase().indexIndicator.count({
      where: { indexCode: { in: scope.indexCodes }, tradeDate: { gte: startDate, lte: endDate } },
    }),
    getDatabase().industryIndicator.count({
      where: { tradeDate: { gte: startDate, lte: endDate } },
    }),
    getDatabase().indexWeight.groupBy({
      by: ['indexCode'],
      where: { indexCode: { in: scope.indexCodes } },
      _min: { tradeDate: true },
    }),
  ]);
  const marketByDate = new Map(marketRows.map((row) => [row.tradeDate, row]));
  const missingDates = expectedDates.filter((date) => !marketByDate.has(date));
  if (scope.market && missingDates.length > 0) {
    throw new Error(`MarketIndicator is missing ${missingDates.join(', ')}`);
  }
  for (const row of scope.market ? marketRows : []) {
    for (const value of [row.advanceRatio, row.aboveMa20Ratio, row.aboveMa60Ratio]) {
      if (value != null && (value < 0 || value > 1)) {
        throw new Error(`MarketIndicator ratio is outside [0, 1] on ${row.tradeDate}`);
      }
    }
  }
  const expectedIndexRows = indexWeightCoverage.reduce(
    (total, coverage) =>
      total + expectedDates.filter((tradeDate) => tradeDate >= coverage._min.tradeDate!).length,
    0,
  );
  if (indexRows < expectedIndexRows) {
    throw new Error(
      `IndexIndicator has ${indexRows} rows; expected at least ${expectedIndexRows} from point-in-time weight coverage`,
    );
  }
  if (scope.industries && industryRows < expectedDates.length * 20) {
    throw new Error(
      `IndustryIndicator has ${industryRows} rows; expected at least ${expectedDates.length * 20}`,
    );
  }

  return {
    startDate,
    endDate,
    marketDates: marketRows.length,
    indexRows,
    industryRows,
  };
}
