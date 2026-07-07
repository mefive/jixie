import { loadTushareConfig } from '../src/config.js';
import { TushareClient } from '../src/tushare/client.js';
import { prisma } from '../src/lib/prisma.js';
import { syncDailyBasic } from '../src/store/sync.js';

/**
 * Sync daily valuation metrics (daily_basic) into the local store.
 * Usage: pnpm --filter api sync:basic [start] [end]   e.g. pnpm --filter api sync:basic 20240101 20241231
 */
async function main(): Promise<void> {
  const cfg = loadTushareConfig();
  const [start = '20240101', end = '20241231'] = process.argv.slice(2);

  const client = new TushareClient({
    token: cfg.token,
    baseUrl: cfg.baseUrl,
    minIntervalMs: cfg.minIntervalMs,
  });

  console.log(`Syncing daily_basic ${start} ~ ${end} (rate limit ${cfg.minIntervalMs}ms/call)\n`);
  await syncDailyBasic(client, start, end);

  console.log('\nStored row counts:');
  console.table({ daily_basic: await prisma.dailyBasic.count() });

  await prisma.$disconnect();
  console.log('✅ Sync complete');
}

main().catch(async (e: unknown) => {
  console.error('\n❌ sync:basic failed: ', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
