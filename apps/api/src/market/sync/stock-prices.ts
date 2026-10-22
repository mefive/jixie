import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';
import { getDatabase } from '#infra/database/prisma.js';
import { syncStockBasic } from '../stocks/basic-sync.js';
import { syncTradeCal } from '../calendar/sync.js';
import { syncDaily } from '../stocks/daily-sync.js';

/**
 * 同步股票原始价格和复权因子到本地存储。
 *
 * Sync stock daily prices and adjustment factors into the local SQLite store (Prisma).
 * Usage: pnpm sync stock-prices [start] [end]   e.g. pnpm sync stock-prices 20240101 20240131
 */
export async function runSyncTask(args: string[]): Promise<void> {
  if (!isStagingDatabase()) {
    throw new Error('Use pnpm sync to prepare and publish market data safely');
  }
  const cfg = loadTushareConfig();
  const [start = '20240101', end = '20240131'] = args;

  const client = new TushareClient({
    token: cfg.token,
    baseUrl: cfg.baseUrl,
    minIntervalMs: cfg.minIntervalMs,
  });

  console.log(`Syncing ${start} ~ ${end} (rate limit ${cfg.minIntervalMs}ms/call)\n`);
  await syncStockBasic(client);
  await syncTradeCal(client, start, end);
  await syncDaily(client, start, end);

  const [sb, tc, d, af] = await Promise.all([
    getDatabase().stockBasic.count(),
    getDatabase().tradeCal.count(),
    getDatabase().daily.count(),
    getDatabase().adjFactor.count(),
  ]);
  console.log('\nStored row counts:');
  console.table({ stock_basic: sb, trade_cal: tc, daily: d, adj_factor: af });
  console.log('✅ Sync complete');
}
