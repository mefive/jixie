import { assertDatasetInputReadiness } from '#market/synchronization/readiness.js';
import { getDatabase } from '#infra/database/prisma.js';
import type { MarketQuote } from './replay.js';

/**
 * 按执行日期读取可用行情，供现金资产成交与估值重放。
 *
 * Load dated cash-asset quotes for fill and valuation replay.
 */
export async function loadMarketQuotes(
  tradeDate: string,
  codes: string[],
): Promise<Map<string, MarketQuote>> {
  const knownEtfs = await getDatabase().etfBasic.findMany({
    where: { tsCode: { in: codes } },
    select: { tsCode: true },
  });
  const etfCodes = new Set(knownEtfs.map((etf) => etf.tsCode));
  const requirements = knownEtfs.map((etf) => ({
    dataset: 'etf-prices',
    scope: etf.tsCode,
    startDate: tradeDate,
    endDate: tradeDate,
  }));
  if (codes.some((code) => !etfCodes.has(code))) {
    requirements.push(
      ...['stock-prices', 'stock-limits'].map((dataset) => ({
        dataset,
        scope: 'all',
        startDate: tradeDate,
        endDate: tradeDate,
      })),
    );
  }
  await assertDatasetInputReadiness(requirements);

  const [stocks, etfs, limits] = await Promise.all([
    getDatabase().daily.findMany({
      where: { tradeDate, tsCode: { in: codes } },
      select: { tsCode: true, open: true, close: true, amount: true },
    }),
    getDatabase().etfDaily.findMany({
      where: { tradeDate, tsCode: { in: codes } },
      select: { tsCode: true, open: true, close: true, amount: true },
    }),
    getDatabase().stkLimit.findMany({
      where: { tradeDate, tsCode: { in: codes } },
      select: { tsCode: true, upLimit: true, downLimit: true },
    }),
  ]);
  const limitByCode = new Map(limits.map((limit) => [limit.tsCode, limit]));
  return new Map(
    [...stocks, ...etfs].map((row) => {
      const limit = limitByCode.get(row.tsCode);
      return [
        row.tsCode,
        {
          open: row.open,
          close: row.close,
          amount: row.amount,
          upLimit: limit?.upLimit ?? null,
          downLimit: limit?.downLimit ?? null,
        },
      ];
    }),
  );
}

export async function nextTradingDate(tradeDate: string): Promise<string | null> {
  const next = await getDatabase().tradeCal.findFirst({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: tradeDate } },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  return next?.calDate ?? null;
}
