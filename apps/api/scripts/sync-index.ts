import { loadTushareConfig } from '../src/config.js';
import { TushareClient } from '../src/tushare/client.js';
import { prisma } from '../src/lib/prisma.js';
import { syncIndexWeight } from '../src/store/sync.js';

/**
 * Sync index constituents (index_weight) into the local store.
 * Usage: pnpm --filter api sync:index [indexCode] [start] [end]
 *   default: 000852.SH (中证1000) 2015-2024
 */
async function main(): Promise<void> {
  const cfg = loadTushareConfig();
  const [indexCode = '000852.SH', start = '20150101', end = '20241231'] = process.argv.slice(2);
  const client = new TushareClient({
    token: cfg.token,
    baseUrl: cfg.baseUrl,
    minIntervalMs: cfg.minIntervalMs,
  });

  console.log(`同步指数成分 ${indexCode} ${start} ~ ${end}\n`);
  await syncIndexWeight(client, indexCode, start, end);

  console.table({ index_weight: await prisma.indexWeight.count() });
  await prisma.$disconnect();
  console.log('✅ 指数成分同步完成');
}

main().catch(async (e: unknown) => {
  console.error('\n❌ sync:index 失败：', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
