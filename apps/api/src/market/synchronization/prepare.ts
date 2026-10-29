import { writeCalendarPartition } from '../calendar/write.js';
import { writeStockPartition } from '../stocks/write.js';
import { writeEtfPartition } from '../etfs/write.js';
import { writeIndexPartition } from '../indices/write.js';
import { writeFinancialPartition } from '../fundamentals/write.js';
import { qualifyMarketPartition } from './qualify.js';
import { prepareCalendarPartition } from '../calendar/sync-partition.js';
import { prepareStockPartition, prepareStockReference } from '../stocks/sync-partition.js';
import { prepareIndexPartition } from '../indices/sync-partition.js';
import { prepareEtfPartition } from '../etfs/sync-partition.js';
import { prepareFinancialPartition } from '../fundamentals/sync-partition.js';
import type { MarketPartition, MarketTransaction, PreparedMarketPartition } from './partition.js';
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

/** 已核验数据由对应领域显式提交。 / Persist validated data through its domain's explicit writer. */
export async function writeMarketPartition(
  transaction: MarketTransaction,
  prepared: PreparedMarketPartition,
  partition: MarketPartition,
  fetchedAt: Date,
) {
  switch (partition.dataset) {
    case 'calendar':
      return writeCalendarPartition(transaction, prepared, partition);
    case 'stock-master':
    case 'stock-names':
    case 'stock-prices':
    case 'stock-adjustments':
    case 'stock-valuations':
    case 'stock-limits':
      return writeStockPartition(transaction, prepared, partition);
    case 'etf-master':
    case 'etf-prices':
    case 'etf-adjustments':
      return writeEtfPartition(transaction, prepared, partition);
    case 'index-prices':
    case 'index-valuations':
    case 'index-weights':
      return writeIndexPartition(transaction, prepared, partition);
    case 'financial-statements':
    case 'financial-indicators':
    case 'dividends':
      return writeFinancialPartition(transaction, prepared, partition, fetchedAt);
    default:
      throw new Error(`Undeclared synchronization dataset ${partition.dataset}`);
  }
}
