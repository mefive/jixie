import { getStagingContext } from '#infra/coordination/staging-input.js';
import { isStagingDatabase } from '#infra/coordination/market-access.js';
import type { TradeDate } from '@jixie/shared';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';
import {
  seedStockCodeChanges,
  syncStockBasic,
  syncStockNameHistory,
} from '../stocks/basic-sync.js';

/**
 * 刷新完整股票主表与历史名称区间，供历史可投资性判断。
 *
 * Refresh the complete stock master and point-in-time historical names.
 * Usage: pnpm --filter api sync stock-history [announcementStart] [announcementEnd]
 */
export async function runSyncTask(args: string[]): Promise<void> {
  if (!isStagingDatabase()) {
    throw new Error('Use pnpm sync to prepare and publish market data safely');
  }
  const config = loadTushareConfig();
  const [start = '19900101', end = getStagingContext()!.date] = args as [TradeDate?, TradeDate?];
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: config.minIntervalMs,
  });

  console.log(`Syncing complete stock reference data and name history ${start} ~ ${end}`);
  const codeChanges = await seedStockCodeChanges();
  const stockBasic = await syncStockBasic(client);
  const stockNameHistory = await syncStockNameHistory(client, start, end);

  console.table({ stockBasic, stockNameHistory, codeChanges });
  console.log('Stock-history sync complete');
}
