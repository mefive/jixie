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

  console.log(`同步 ${start} ~ ${end}（限频 ${cfg.minIntervalMs}ms/次）\n`);
  await syncStockBasic(client);
  await syncTradeCal(client, start, end);
  await syncDaily(client, start, end);

  const [sb, tc, d, af] = await Promise.all([
    prisma.stockBasic.count(),
    prisma.tradeCal.count(),
    prisma.daily.count(),
    prisma.adjFactor.count(),
  ]);
  console.log('\n落库统计:');
  console.table({ stock_basic: sb, trade_cal: tc, daily: d, adj_factor: af });

  await prisma.$disconnect();
  console.log('✅ 同步完成');
}

main().catch(async (e: unknown) => {
  console.error('\n❌ sync 失败：', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
