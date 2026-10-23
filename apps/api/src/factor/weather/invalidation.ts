import type { Prisma } from '@prisma/client';
import type { AcceptedMarketChange } from '#market/synchronization/partition.js';

const INPUTS = new Set([
  'StockBasic',
  'Daily',
  'AdjFactor',
  'DailyBasic',
  'StkLimit',
  'Moneyflow',
  'TopList',
  'StockNameHistory',
  'StockCodeChange',
  'SwIndustryMember',
  'FinaIndicatorVersion',
  'TradeCal',
]);

/**
 * 当前气象从最早受影响期增量重算；固定报告和无关参考元数据不受影响。
 *
 * Recompute current weather from the earliest affected period, excluding sealed reports and
 * unrelated reference metadata.
 */
export async function invalidateFactorWeather(
  transaction: Prisma.TransactionClient,
  changes: AcceptedMarketChange[],
): Promise<void> {
  const dates = changes
    .filter((change) => INPUTS.has(change.table))
    .flatMap((change) =>
      [change.before, change.after].flatMap((row) => {
        if (!row) {
          return [];
        }
        const date =
          row.availableDate ??
          row.listDate ??
          row.tradeDate ??
          row.calDate ??
          row.effectiveDate ??
          row.startDate ??
          row.inDate;

        return typeof date === 'string' ? [date] : [];
      }),
    )
    .sort();
  const dirtyFrom = dates[0];
  if (!dirtyFrom) {
    return;
  }
  await transaction.factorWeatherPin.updateMany({
    where: { OR: [{ dirtyFrom: null }, { dirtyFrom: { gt: dirtyFrom } }] },
    data: { dirtyFrom, status: 'pending' },
  });
}
