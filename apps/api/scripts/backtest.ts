import { prisma } from '../src/lib/prisma.js';
import { runStrategy } from '../src/engine/run.js';
import { crossSectionStrategy, SIGNALS } from '../src/engine/strategies.js';

const pct = (x: number) => (x * 100).toFixed(2) + '%';

/**
 * Event-driven strategy backtest.
 * Usage: pnpm --filter api backtest [signal] [low|high] [quantile]
 *   value example: pnpm --filter api backtest ep high 0.1   (cheapest decile by earnings yield)
 *   price example: pnpm --filter api backtest vol low 0.1    (low-volatility decile)
 * Signals: ep / bp / dv / size (from daily_basic) · mom / rev / vol (computed on the fly from bars)
 */
async function main(): Promise<void> {
  const [signal = 'ep', side = 'high', q = '0.1'] = process.argv.slice(2);
  if (!SIGNALS[signal]) {
    console.error(`未知信号 "${signal}"，可选：${Object.keys(SIGNALS).join(' / ')}`);
    process.exitCode = 1;
    return;
  }
  const strategy = crossSectionStrategy({
    signal,
    side: side as 'low' | 'high',
    quantile: Number(q),
  });

  const r = await runStrategy({
    start: '20150101',
    end: '20241231',
    initialCash: 1_000_000,
    strategy,
  });

  console.log(`\n策略 ${r.name}  [${SIGNALS[signal].label}]`);
  console.log(`${r.start} ~ ${r.end}  (${r.days} 个交易日)`);
  console.log('-'.repeat(60));
  console.log(`期初资金   ${r.initialCash.toLocaleString()}`);
  console.log(`期末权益   ${Math.round(r.finalValue).toLocaleString()}`);
  console.log(`累计收益   ${pct(r.totalReturn)}`);
  console.log(`年化收益   ${pct(r.annReturn)}  (已扣交易成本)`);
  console.log(`Sharpe     ${r.sharpe.toFixed(2)}`);
  console.log(`最大回撤   ${pct(r.maxDrawdown)}`);
  console.log(`成交笔数   ${r.trades}`);
  console.log(`\n提示：这是扣成本的真实策略净值；可与 factor:report 里该因子分层的税前结果对比。`);

  await prisma.$disconnect();
}

main().catch(async (e: unknown) => {
  console.error('❌ backtest 失败：', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
