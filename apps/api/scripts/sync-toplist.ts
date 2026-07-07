import { loadTushareConfig } from '../src/config.js';
import { TushareClient } from '../src/tushare/client.js';
import { prisma } from '../src/lib/prisma.js';
import { syncTopList } from '../src/store/sync.js';

/**
 * Sync Dragon-Tiger List (LHB) net buy per day into TopList — read exact-date via ctx.lhbNet(code).
 * Resumable. Usage: pnpm sync:toplist [start] [end]   e.g. pnpm sync:toplist 20200101 20241231
 */
async function main(): Promise<void> {
  const cfg = loadTushareConfig();
  const [start = '20240101', end = '20241231'] = process.argv.slice(2);

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
  console.table({ top_list: await prisma.topList.count() });

  await prisma.$disconnect();
  console.log('✅ Dragon-Tiger List sync complete');
}

main().catch(async (e: unknown) => {
  console.error('\n❌ sync:toplist failed: ', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
