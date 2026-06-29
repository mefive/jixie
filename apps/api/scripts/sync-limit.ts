import { loadTushareConfig } from '../src/config.js';
import { TushareClient } from '../src/tushare/client.js';
import { prisma } from '../src/lib/prisma.js';
import { syncStkLimit } from '../src/store/sync.js';

/**
 * Sync daily price limits (涨/跌停价) into the local store — what the engine reads to block fills at the
 * limit (涨停不可买、跌停不可卖). Resumable: skips trading days already loaded.
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

  console.log(`同步涨跌停 ${start} ~ ${end}（限频 ${cfg.minIntervalMs}ms/次）\n`);
  await syncStkLimit(client, start, end);

  console.log('\n落库统计:');
  console.table({ stk_limit: await prisma.stkLimit.count() });

  await prisma.$disconnect();
  console.log('✅ 涨跌停同步完成');
}

main().catch(async (e: unknown) => {
  console.error('\n❌ sync:limit 失败：', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
