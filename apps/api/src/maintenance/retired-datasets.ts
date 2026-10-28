import { getDatabase } from '#infra/database/prisma.js';
import {
  assertMaintenanceOwner,
  withMarketPublication,
} from '#infra/coordination/market-access.js';

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
 * 持有维护锁时，仅清理已退役来源的维护记录。
 *
 * Remove maintenance records for retired sources while holding the maintenance lock.
 */
export async function retireDatasets(): Promise<void> {
  assertMaintenanceOwner();

  await withMarketPublication(() =>
    getDatabase().$transaction([
      getDatabase().marketCalculationState.deleteMany({
        where: { kind: { in: ['market-state', 'commodity-continuous', 'future-publication'] } },
      }),
      getDatabase().tradeCal.deleteMany({
        where: { exchange: { in: RETIRED_EXCHANGES } },
      }),
      getDatabase().datasetSyncPartition.deleteMany({
        where: {
          dataset: 'calendar',
          scope: { in: RETIRED_EXCHANGES },
        },
      }),
      getDatabase().datasetSyncState.deleteMany({
        where: {
          dataset: 'calendar',
          scope: { in: RETIRED_EXCHANGES },
        },
      }),
      getDatabase().datasetSyncPartition.deleteMany({
        where: { dataset: { in: RETIRED_DATASETS } },
      }),
      getDatabase().datasetSyncState.deleteMany({
        where: { dataset: { in: RETIRED_DATASETS } },
      }),
      getDatabase().marketRecordEvidence.deleteMany({
        where: {
          tableName: {
            in: [
              'EtfShareSize',
              'Moneyflow',
              'TopList',
              'SwIndustryMember',
              'SwIndexDaily',
              'FutureContract',
              'FutureDaily',
              'FutureMapping',
              'FutureSettlement',
              'CommodityWarehouseReceipt',
              'CommodityHoldingPosition',
              'CommodityContinuousReturn',
              'FutureMarketPublication',
              'FutureMarketRevision',
              'YieldCurvePoint',
              'FxDaily',
              'MacroSeries',
              'MacroObservation',
              'MacroReleaseSchedule',
              'MarketBenchmark',
              'MarketBenchmarkDaily',
            ],
          },
        },
      }),
    ]),
  );
}
