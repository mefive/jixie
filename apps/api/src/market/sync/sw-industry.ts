import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';
import { syncSwIndustry } from '../indices/sync.js';

/**
 * 同步申万 SW2021 一级行业成员历史，供时点行业归属查询。
 *
 * Sync Shenwan (SW2021) level-1 industry membership into the local store — the point-in-time
 * (stock → industry) map behind factor industry-neutralization (3.4).
 * Usage: pnpm --filter api sync sw-industry
 *
 * Full overwrite each run (small volume). Two calls per industry (current + historical members),
 * 31 industries, so a ~300ms interval keeps it well under Tushare rate limits.
 */
export async function runSyncTask(_args: string[]): Promise<void> {
  if (!isStagingDatabase()) {
    throw new Error('Use pnpm sync to prepare and publish market data safely');
  }
  const cfg = loadTushareConfig();
  const client = new TushareClient({
    token: cfg.token,
    baseUrl: cfg.baseUrl,
    minIntervalMs: Math.max(cfg.minIntervalMs, 300),
  });

  console.log('Syncing Shenwan (SW2021) level-1 industry membership\n');
  const count = await syncSwIndustry(client);

  console.log('\nStored row counts:');
  console.table({ sw_industry_member: count });
  console.log('✅ SW industry sync complete');
}
