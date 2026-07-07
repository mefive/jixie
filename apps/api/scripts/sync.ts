import { loadTushareConfig } from '../src/config.js';
import { TushareClient } from '../src/tushare/client.js';
import { prisma } from '../src/lib/prisma.js';
import { syncStockBasic, syncTradeCal, syncDaily } from '../src/store/sync.js';

/**
 * Sync market data into the local SQLite store (Prisma).
 * Usage: pnpm sync [start] [end]   e.g. pnpm sync 20240101 20240131
 */
async function main(): Promise<void> {
  const cfg = loadTushareConfig();
  const [start = '20240101', end = '20240131'] = process.argv.slice(2);

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
    prisma.stockBasic.count(),
    prisma.tradeCal.count(),
    prisma.daily.count(),
    prisma.adjFactor.count(),
  ]);
  console.log('\nStored row counts:');
  console.table({ stock_basic: sb, trade_cal: tc, daily: d, adj_factor: af });

  await prisma.$disconnect();
  console.log('✅ Sync complete');
}

main().catch(async (e: unknown) => {
  console.error('\n❌ sync failed: ', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
