import { isStagingDatabase } from '#infra/coordination/market-access.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { TushareClient } from '../providers/tushare/tushare-client.js';
import { getDatabase } from '#infra/database/prisma.js';
import { syncMoneyflow } from '../stocks/flows-sync.js';

/**
 * 同步个股每日资金流，保留主力与总净流入的区分。
 *
 * Sync per-stock daily moneyflow into the Moneyflow table (netMain = main-force net / netTotal = total
 * net, in 10k CNY) — the attention/capital-flow signal, read via a strategy's `factors: ['mf_net_main']`
 * + `ctx.factor(...)`. Resumable.
 * Usage: pnpm sync moneyflow [start] [end]   e.g. pnpm sync moneyflow 20200101 20241231
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

  console.log(`Syncing moneyflow ${start} ~ ${end} (rate limit ${cfg.minIntervalMs}ms/call)\n`);
  await syncMoneyflow(client, start, end);

  console.log('\nStored row counts:');
  console.table({
    MoneyflowRows: await getDatabase().moneyflow.count(),
    WithTotalNet: await getDatabase().moneyflow.count({ where: { netTotal: { not: null } } }),
  });
  console.log('✅ Moneyflow sync complete');
}
