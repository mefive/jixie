import { loadTushareConfig } from '../src/config.js';
import { TushareClient } from '../src/tushare/client.js';
import { prisma } from '../src/lib/prisma.js';
import { syncStkLimit } from '../src/store/sync.js';

/**
 * Sync daily price limits (limit-up / limit-down prices) into the local store — what the engine reads
 * to block fills at the limit (no buy at limit-up, no sell at limit-down). Resumable: skips trading
 * days already loaded.
 * Usage: pnpm sync:limit [start] [end]   e.g. pnpm sync:limit 20150101 20241231
 */
async function main(): Promise<void> {
  const cfg = loadTushareConfig();
  const [start = '20240101', end = '20241231'] = process.argv.slice(2);

  const client = new TushareClient({
    token: cfg.token,
    baseUrl: cfg.baseUrl,
    minIntervalMs: cfg.minIntervalMs,
  });

  console.log(`Syncing price limits ${start} ~ ${end} (rate limit ${cfg.minIntervalMs}ms/call)\n`);
  await syncStkLimit(client, start, end);

  console.log('\nStored row counts:');
  console.table({ stk_limit: await prisma.stkLimit.count() });

  await prisma.$disconnect();
  console.log('✅ Price limit sync complete');
}

main().catch(async (e: unknown) => {
  console.error('\n❌ sync:limit failed: ', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
