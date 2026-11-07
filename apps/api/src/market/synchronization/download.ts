import { downloadStockPartition, downloadStockNames } from '../stocks/sync-partition.js';
import { downloadEtfSeries } from '../etfs/sync-partition.js';
import { downloadIndexPartition } from '../indices/sync-partition.js';
import { downloadFinancialPartition } from '../fundamentals/sync-partition.js';
import { fetchEtfSizes } from '../downloads/select-etfs.js';
import type { MarketPartition } from './partition.js';
import { withoutSourceRowAccumulation, type SyncSource } from './source.js';

/**
 * 并发阶段仅下载，依赖可变业务数据的准备在写入端执行。
 *
 * Concurrent work downloads only; the writer prepares against current business state.
 */
export async function downloadMarketPartition(source: SyncSource, partition: MarketPartition) {
  await withoutSourceRowAccumulation(async () => {
    switch (partition.dataset) {
      case 'etf-selection':
        await fetchEtfSizes(source, partition.endDate);
        break;
      case 'stock-prices':
      case 'stock-adjustments':
      case 'stock-valuations':
      case 'stock-limits':
        await downloadStockPartition(source, partition);
        break;
      case 'stock-names':
        await downloadStockNames(source, partition);
        break;
      case 'etf-prices':
      case 'etf-adjustments':
        await downloadEtfSeries(source, partition);
        break;
      case 'index-prices':
      case 'index-valuations':
      case 'index-weights':
        await downloadIndexPartition(source, partition);
        break;
      case 'financial-statements':
      case 'financial-indicators':
      case 'dividends':
        await downloadFinancialPartition(source, partition);
        break;
      default:
        throw new Error(`No prefetch recipe for ${partition.dataset}`);
    }
  });
}
