import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';
import { getDatabase } from '#infra/database/prisma.js';
import { syncDailyBasic } from '../stocks/daily-sync.js';

/**
 * 解析 CLI 区间并同步每日估值指标，输出结果并关闭数据库连接。
 *
 * Sync daily valuation metrics (daily_basic) into the local store.
 * Usage: pnpm --filter api sync basic [start] [end]   e.g. pnpm --filter api sync basic 20240101 20241231
 */
export async function runSyncTask(args: string[]): Promise<void> {
  if (!isStagingDatabase()) {
    throw new Error('Use pnpm sync to prepare and publish market data safely');
  }
  const cfg = loadTushareConfig();
  const [start = '20240101', end = '20241231'] = args;

  const client = new TushareClient({
    token: cfg.token,
    baseUrl: cfg.baseUrl,
    minIntervalMs: cfg.minIntervalMs,
  });

  console.log(`Syncing daily_basic ${start} ~ ${end} (rate limit ${cfg.minIntervalMs}ms/call)\n`);
  await syncDailyBasic(client, start, end);

  console.log('\nStored row counts:');
  console.table({ daily_basic: await getDatabase().dailyBasic.count() });
  console.log('✅ Sync complete');
}
