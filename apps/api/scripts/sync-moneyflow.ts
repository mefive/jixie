import { loadTushareConfig } from '../src/config.js';
import { TushareClient } from '../src/tushare/client.js';
import { prisma } from '../src/lib/prisma.js';
import { syncMoneyflow, MF_FACTORS } from '../src/store/sync.js';

/**
 * Sync per-stock daily moneyflow into FactorValue (mf_net_main 主力净额 / mf_net_total 总净额, 万元) — the
 * 关注度/资金 signal, read via a strategy's `factors: ['mf_net_main']` + `ctx.factor(...)`. Resumable.
 * Usage: pnpm sync:moneyflow [start] [end]   e.g. pnpm sync:moneyflow 20200101 20241231
 */
async function main(): Promise<void> {
  const cfg = loadTushareConfig();
  const [start = '20240101', end = '20241231'] = process.argv.slice(2);

  const client = new TushareClient({
    token: cfg.token,
    baseUrl: cfg.baseUrl,
    minIntervalMs: cfg.minIntervalMs,
  });

  console.log(`同步资金流 ${start} ~ ${end}（限频 ${cfg.minIntervalMs}ms/次）\n`);
  await syncMoneyflow(client, start, end);

  console.log('\n落库统计:');
  console.table({
    mf_net_total: await prisma.factorValue.count({ where: { factor: 'mf_net_total' } }),
    mf_net_main: await prisma.factorValue.count({ where: { factor: 'mf_net_main' } }),
    factors: [...MF_FACTORS].join(' / '),
  });

  await prisma.$disconnect();
  console.log('✅ 资金流同步完成');
}

main().catch(async (e: unknown) => {
  console.error('\n❌ sync:moneyflow 失败：', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
