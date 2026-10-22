import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';
import { getDatabase } from '#infra/database/prisma.js';
import { syncTopList } from '../stocks/flows-sync.js';

/**
 * 按交易日同步龙虎榜净买入，供精确日期查询。
 *
 * Sync Dragon-Tiger List (LHB) net buy per day into TopList — read exact-date via ctx.lhbNet(code).
 * Resumable. Usage: pnpm sync toplist [start] [end]   e.g. pnpm sync toplist 20200101 20241231
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

  console.log(
    `Syncing Dragon-Tiger List ${start} ~ ${end} (rate limit ${cfg.minIntervalMs}ms/call)\n`,
  );
  await syncTopList(client, start, end);

  console.log('\nStored row counts:');
  console.table({ top_list: await getDatabase().topList.count() });
  console.log('✅ Dragon-Tiger List sync complete');
}
