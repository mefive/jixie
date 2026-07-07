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
    console.error(`Unknown signal "${signal}", options: ${Object.keys(SIGNALS).join(' / ')}`);
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

  console.log(`\nStrategy ${r.name}  [${SIGNALS[signal].label}]`);
  console.log(`${r.start} ~ ${r.end}  (${r.days} trading days)`);
  console.log('-'.repeat(60));
  console.log(`Initial cash    ${r.initialCash.toLocaleString()}`);
  console.log(`Final equity    ${Math.round(r.finalValue).toLocaleString()}`);
  console.log(`Total return    ${pct(r.totalReturn)}`);
  console.log(`Annualized      ${pct(r.annReturn)}  (net of transaction costs)`);
  console.log(`Sharpe          ${r.sharpe.toFixed(2)}`);
  console.log(`Max drawdown    ${pct(r.maxDrawdown)}`);
  console.log(`Trade count     ${r.trades}`);
  console.log(
    `\nNote: this is the real strategy NAV net of costs; compare against the pre-tax layered result for this factor in factor:report.`,
  );

  await prisma.$disconnect();
}

main().catch(async (e: unknown) => {
  console.error('❌ backtest failed:', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
