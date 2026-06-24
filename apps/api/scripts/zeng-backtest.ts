import { prisma } from '../src/lib/prisma.js';
import { runStrategy } from '../src/engine/run.js';
import { computeBuyDates, makeZengStrategy } from '../src/strategy/zeng.js';

const pct = (x: number) => (x * 100).toFixed(2) + '%';

/**
 * 曾庆辉 strategy backtest — Phase 1 breadth timing (CSI1800, full pattern, gate 30%) + Phase 2
 * quality/dividend/MA selection. Usage: pnpm --filter api zeng:backtest
 *
 * Capital 2,000,000 split into 20 units of 100,000; buy 1 unit per qualifier on each entry date,
 * exit on a MA20/MA90 death cross. Requires fina_indicator + dividend + index_weight synced.
 */
async function main(): Promise<void> {
  const start = '20150101';
  const end = '20241231';
  const indexCodes = ['000906.SH', '000852.SH']; // CSI1800

  console.log('Phase 1: 计算 buy_date(中证1800,完整形态,门槛30%)…');
  const buyDates = await computeBuyDates({ start, end, indexCodes, floor: 0.3, lookback: 0, minGap: 20 });
  console.log(`buy_date ${buyDates.length} 个:`);
  for (const b of buyDates) console.log(`  ${b.buyDate} → 入场 ${b.entryDate}  广度 ${pct(b.breadth)}`);

  console.log('\nPhase 2: 预加载财务 + 跑回测…');
  const strategy = await makeZengStrategy({ start, end, buyDates });
  const r = await runStrategy({ start, end, initialCash: 2_000_000, strategy });

  console.log(`\n策略 ${r.name}（广度择时 + 优质高分红选股，MA 死叉离场）`);
  console.log(`${r.start} ~ ${r.end}  (${r.days} 个交易日)`);
  console.log('-'.repeat(60));
  console.log(`期初资金   ${r.initialCash.toLocaleString()}  (20 unit × 10 万)`);
  console.log(`期末权益   ${Math.round(r.finalValue).toLocaleString()}`);
  console.log(`累计收益   ${pct(r.totalReturn)}`);
  console.log(`年化收益   ${pct(r.annReturn)}  (已扣交易成本)`);
  console.log(`Sharpe     ${r.sharpe.toFixed(2)}`);
  console.log(`最大回撤   ${pct(r.maxDrawdown)}`);
  console.log(`成交笔数   ${r.trades}`);

  await prisma.$disconnect();
}

main().catch(async (e: unknown) => {
  console.error('❌ zeng:backtest 失败：', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
