import { loadTushareConfig } from '../src/config.js';
import { TushareClient } from '../src/tushare/client.js';
import { prisma } from '../src/lib/prisma.js';
import { syncFinaIndicator, syncDividend } from '../src/store/sync.js';

/**
 * Sync per-stock financials (ROE via fina_indicator + dividend history) into the local store.
 * Usage: pnpm --filter api sync:fina
 *
 * Financial APIs are rate-limited (~80/min on lower tiers), so this uses a ≥800ms interval. Both
 * syncs are resumable (skip stocks already present), so an interrupted run can simply be re-run.
 */
async function main(): Promise<void> {
  const cfg = loadTushareConfig();
  const interval = Math.max(cfg.minIntervalMs, 800); // respect the financial 80/min limit
  const client = new TushareClient({ token: cfg.token, baseUrl: cfg.baseUrl, minIntervalMs: interval });

  console.log(`同步财务数据（fina_indicator + dividend，限频 ${interval}ms/次）\n`);
  await syncFinaIndicator(client);
  await syncDividend(client);

  console.log('\n落库统计:');
  console.table({
    fina_indicator: await prisma.finaIndicator.count(),
    dividend: await prisma.dividend.count(),
  });

  await prisma.$disconnect();
  console.log('✅ 财务同步完成');
}

main().catch(async (e: unknown) => {
  console.error('\n❌ sync:fina 失败：', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
