import { loadTushareConfig } from '../src/config.js';
import { TushareClient } from '../src/tushare/client.js';
import { prisma } from '../src/lib/prisma.js';
import { syncIndexWeight, syncIndexDaily } from '../src/store/sync.js';

/**
 * Sync index constituents (index_weight) + daily close (index_daily) into the local store.
 * Usage: pnpm --filter api sync:index [indexCode] [start] [end]
 *   default: 000852.SH (CSI 1000) 2015-2024
 */
async function main(): Promise<void> {
  const cfg = loadTushareConfig();
  const [indexCode = '000852.SH', start = '20150101', end = '20241231'] = process.argv.slice(2);
  const client = new TushareClient({
    token: cfg.token,
    baseUrl: cfg.baseUrl,
    minIntervalMs: cfg.minIntervalMs,
  });

  console.log(`Syncing index constituents + daily close ${indexCode} ${start} ~ ${end}\n`);
  await syncIndexWeight(client, indexCode, start, end);
  await syncIndexDaily(client, indexCode, start, end);

  console.table({
    index_weight: await prisma.indexWeight.count(),
    index_daily: await prisma.indexDaily.count(),
  });
  await prisma.$disconnect();
  console.log('✅ Index constituents sync complete');
}

main().catch(async (e: unknown) => {
  console.error('\n❌ sync:index failed: ', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
