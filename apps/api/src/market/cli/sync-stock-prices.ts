import { loadTushareConfig } from '../providers/tushare/config.js';
import { TushareClient } from '../providers/tushare/client.js';
import { prisma } from '#infra/database/prisma.js';
import { syncStockBasic } from '../sync/stocks.js';
import { syncTradeCal } from '../sync/calendar.js';
import { syncDaily } from '../sync/stock-daily.js';

/**
 * Sync stock daily prices and adjustment factors into the local SQLite store (Prisma).
 * Usage: pnpm sync:stock-prices [start] [end]   e.g. pnpm sync:stock-prices 20240101 20240131
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
  console.error('\n❌ sync:stock-prices failed: ', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
