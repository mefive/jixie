import { loadTushareConfig } from '../src/config.js';
import { TushareClient } from '../src/tushare/client.js';
import { prisma } from '../src/lib/prisma.js';
import { syncTopList } from '../src/store/sync.js';

/**
 * Sync 龙虎榜 (Dragon-Tiger List) net buy per day into TopList — read exact-date via ctx.lhbNet(code).
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

  console.log(`同步龙虎榜 ${start} ~ ${end}（限频 ${cfg.minIntervalMs}ms/次）\n`);
  await syncTopList(client, start, end);

  console.log('\n落库统计:');
  console.table({ top_list: await prisma.topList.count() });

  await prisma.$disconnect();
  console.log('✅ 龙虎榜同步完成');
}

main().catch(async (e: unknown) => {
  console.error('\n❌ sync:toplist 失败：', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
