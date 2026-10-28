import { qualifyMarketPartition } from './qualify.js';
import { prepareCalendarPartition } from '../calendar/sync-partition.js';
import { prepareStockPartition, prepareStockReference } from '../stocks/sync-partition.js';
import { prepareIndexPartition } from '../indices/sync-partition.js';
import { prepareEtfPartition } from '../etfs/sync-partition.js';
import { prepareFinancialPartition } from '../fundamentals/sync-partition.js';
import type { MarketPartition, PreparedMarketPartition } from './partition.js';
import type { SyncSource } from './source.js';

export interface SyncProviders {
  source: SyncSource;
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
    case 'index-prices':
    case 'index-valuations':
    case 'index-weights':
      return prepareIndexPartition(providers.source, partition);
    case 'etf-master':
    case 'etf-prices':
    case 'etf-adjustments':
      return prepareEtfPartition(providers.source, partition);
    case 'financial-statements':
    case 'financial-indicators':
    case 'dividends':
      return prepareFinancialPartition(providers.source, partition, fetchedAt);
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
