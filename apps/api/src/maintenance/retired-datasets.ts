import type { MarketTransaction } from '#market/synchronization/partition.js';
import type { PreparedCleanup } from '#market/synchronization/cleanup.js';

export const RETIRED_EXCHANGES = [
  'CFFEX',
  'SHFE',
  'DCE',
  'CZCE',
  'INE',
  'GFEX',
  'US_TREASURY',
  'FXCM',
  'HKEX',
  'NYSE',
  'NASDAQ',
];

export const RETIRED_DATASETS = [
  'stock-moneyflow',
  'stock-toplist',
  'industry-members',
  'industry-prices',
  'future-contracts',
  'future-prices',
  'future-mappings',
  'future-settlements',
  'commodity-contracts',
  'commodity-prices',
  'commodity-mappings',
  'commodity-holdings',
  'commodity-receipts',
  'treasury-curves',
  'credit-curves',
  'external-curves',
  'external-fx',
  'cross-market-benchmarks',
  'china-macro',
  'us-cpi',
  'index-catalog',
  'etf-shares',
];

/**
 * 退役范围只清理日历和维护记录；日常同步不再重复执行。
 *
 * Retired scope cleanup affects only calendars and maintenance records, never routine sync.
 */
export async function prepareRetiredCleanup(
  transaction: MarketTransaction,
): Promise<PreparedCleanup> {
  const calendar = { exchange: { in: RETIRED_EXCHANGES } };
  const metadata = {
    OR: [
      { dataset: { in: RETIRED_DATASETS } },
      { dataset: 'calendar', scope: { in: RETIRED_EXCHANGES } },
    ],
  };
  const counts = await Promise.all([
    transaction.tradeCal.count({ where: calendar }),
    transaction.datasetSyncPartition.count({ where: metadata }),
    transaction.datasetSyncState.count({ where: metadata }),
  ]);
  const tables = ['TradeCal', 'DatasetSyncPartition', 'DatasetSyncState'];

  return {
    items: counts.flatMap((count, index) =>
      count
        ? [
            {
              table: tables[index],
              count,
              reason: 'Retired maintenance scope',
            },
          ]
        : [],
    ),
    retained: [],
    coverage: [],
    apply: async () => {
      const calendars = await transaction.tradeCal.deleteMany({ where: calendar });
      const partitions = await transaction.datasetSyncPartition.deleteMany({ where: metadata });
      const states = await transaction.datasetSyncState.deleteMany({ where: metadata });

      return calendars.count + partitions.count + states.count;
    },
  };
}
