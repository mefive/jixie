import { prisma } from '#infra/database/prisma.js';
import { MARKET_WEATHER_INDICATOR_INDEX_CODES } from '../registry/index-presets.js';

export interface DerivedRangeQuality {
  startDate: string;
  endDate: string;
  marketDates: number;
  indexRows: number;
  industryRows: number;
}

export async function validateDerivedMarketRange(
  startDate: string,
  endDate: string,
  expectedDates: string[],
): Promise<DerivedRangeQuality> {
  const [marketRows, indexRows, industryRows, indexWeightCoverage] = await Promise.all([
    prisma.marketIndicator.findMany({
      where: { tradeDate: { gte: startDate, lte: endDate } },
      select: {
        tradeDate: true,
        advanceRatio: true,
        aboveMa20Ratio: true,
        aboveMa60Ratio: true,
      },
    }),
    prisma.indexIndicator.count({ where: { tradeDate: { gte: startDate, lte: endDate } } }),
    prisma.industryIndicator.count({ where: { tradeDate: { gte: startDate, lte: endDate } } }),
    prisma.indexWeight.groupBy({
      by: ['indexCode'],
      where: { indexCode: { in: MARKET_WEATHER_INDICATOR_INDEX_CODES } },
      _min: { tradeDate: true },
    }),
  ]);
  const marketByDate = new Map(marketRows.map((row) => [row.tradeDate, row]));
  const missingDates = expectedDates.filter((date) => !marketByDate.has(date));
  if (missingDates.length > 0) {
    throw new Error(`MarketIndicator is missing ${missingDates.join(', ')}`);
  }
  for (const row of marketRows) {
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
  if (industryRows < expectedDates.length * 20) {
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
