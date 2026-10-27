import { qualifyMarketPartition } from './qualify.js';
import { prepareCalendarPartition } from '../calendar/sync-partition.js';
import { prepareStockPartition, prepareStockReference } from '../stocks/sync-partition.js';
import { prepareIndexPartition } from '../indices/sync-partition.js';
import { prepareEtfPartition } from '../etfs/sync-partition.js';
import { prepareFuturePartition } from '../futures/sync-partition.js';
import { prepareFinancialPartition } from '../fundamentals/sync-partition.js';
import { prepareMacroPartition } from '../macro/sync-partition.js';
import { prepareCurvePartition } from '../rates/sync-partition.js';
import { prepareExternalPartition } from '../cross-market/sync-partition.js';
import { prepareCommodityPartition } from '../commodity/sync-partition.js';
import type { BlsPublicDataClientLike } from '../macro/us-headline-cpi.js';
import type { ChinaTreasuryCurveClient } from '../rates/china-treasury-curve.js';
import type { ChinaBondCreditCurveClient } from '../rates/chinabond-credit-curves.js';
import type { MarketPartition, PreparedMarketPartition } from './partition.js';
import type { SyncSource } from './source.js';

export interface SyncProviders {
  source: SyncSource;
  treasury: ChinaTreasuryCurveClient;
  credit: ChinaBondCreditCurveClient;
  cpi: BlsPublicDataClientLike;
}

/**
 * 显式数据目录分派，只组合 Market 获取规则，不持锁或调用其他业务。
 *
 * Explicitly dispatch Market acquisition rules without locks or cross-domain work.
 */
async function fetchMarketPartition(
  providers: SyncProviders,
  partition: MarketPartition,
  fetchedAt: Date,
): Promise<PreparedMarketPartition> {
  switch (partition.dataset) {
    case 'calendar':
      return prepareCalendarPartition(providers.source, partition);
    case 'stock-master':
    case 'stock-names':
      return prepareStockReference(providers.source, partition);
    case 'stock-prices':
    case 'stock-adjustments':
    case 'stock-valuations':
    case 'stock-limits':
      return prepareStockPartition(providers.source, partition);
    case 'industry-members':
    case 'index-catalog':
    case 'index-prices':
    case 'index-valuations':
    case 'index-weights':
    case 'industry-prices':
      return prepareIndexPartition(providers.source, partition);
    case 'etf-master':
    case 'etf-prices':
    case 'etf-adjustments':
    case 'etf-shares':
      return prepareEtfPartition(providers.source, partition);
    case 'future-contracts':
    case 'future-prices':
    case 'future-mappings':
    case 'future-settlements':
    case 'commodity-contracts':
    case 'commodity-prices':
    case 'commodity-mappings':
      return prepareFuturePartition(providers.source, partition);
    case 'financial-statements':
    case 'financial-indicators':
    case 'dividends':
      return prepareFinancialPartition(providers.source, partition, fetchedAt);
    case 'china-macro':
    case 'us-cpi':
      return prepareMacroPartition(providers.source, providers.cpi, partition, fetchedAt);
    case 'treasury-curves':
    case 'credit-curves':
      return prepareCurvePartition(providers.treasury, providers.credit, partition, fetchedAt);
    case 'external-curves':
    case 'external-fx':
    case 'cross-market-benchmarks':
      return prepareExternalPartition(providers.source, partition, fetchedAt);
    case 'commodity-holdings':
    case 'commodity-receipts':
      return prepareCommodityPartition(providers.source, partition, fetchedAt);
    default:
      throw new Error(`Undeclared synchronization dataset ${partition.dataset}`);
  }
}

export async function prepareMarketPartition(
  providers: SyncProviders,
  partition: MarketPartition,
  fetchedAt: Date,
): Promise<PreparedMarketPartition> {
  const prepared = await fetchMarketPartition(providers, partition, fetchedAt);

  return qualifyMarketPartition(partition, prepared);
}
