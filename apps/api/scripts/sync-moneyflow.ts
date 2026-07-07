import { loadTushareConfig } from '../src/config.js';
import { TushareClient } from '../src/tushare/client.js';
import { prisma } from '../src/lib/prisma.js';
import { syncMoneyflow } from '../src/store/sync.js';

/**
 * Sync per-stock daily moneyflow into the Moneyflow table (netMain = main-force net / netTotal = total
 * net, in 10k CNY) — the attention/capital-flow signal, read via a strategy's `factors: ['mf_net_main']`
 * + `ctx.factor(...)`. Resumable.
 * Usage: pnpm sync:moneyflow [start] [end]   e.g. pnpm sync:moneyflow 20200101 20241231
 */
async function main(): Promise<void> {
  const cfg = loadTushareConfig();
  const [start = '20240101', end = '20241231'] = process.argv.slice(2);

  const client = new TushareClient({
    token: cfg.token,
    baseUrl: cfg.baseUrl,
    minIntervalMs: cfg.minIntervalMs,
  });

  console.log(`Syncing moneyflow ${start} ~ ${end} (rate limit ${cfg.minIntervalMs}ms/call)\n`);
  await syncMoneyflow(client, start, end);

  console.log('\nStored row counts:');
  console.table({
    MoneyflowRows: await prisma.moneyflow.count(),
    WithTotalNet: await prisma.moneyflow.count({ where: { netTotal: { not: null } } }),
  });

  await prisma.$disconnect();
  console.log('✅ Moneyflow sync complete');
}

main().catch(async (e: unknown) => {
  console.error('\n❌ sync:moneyflow failed: ', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
