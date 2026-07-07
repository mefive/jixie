import { prisma } from '../src/lib/prisma.js';
import { runStrategy } from '../src/engine/run.js';
import { crossSectionStrategy } from '../src/engine/strategies.js';
import { runCodeBacktest } from '../src/strategy/code/run.js';
import type { BacktestResult } from '../src/engine/types.js';

const pct = (x: number) => (x * 100).toFixed(2) + '%';

/**
 * Proof of the code-first loop + SDK stdlib parity: a cross-section EP strategy written as a TS *string*
 * (what a user types) compiles and runs through the same engine as the IR-era `crossSectionStrategy`, and
 * the two come out identical — i.e. the SDK helpers (select/rankBy/dropBottom/equalWeight/period) express
 * a structured strategy in a few lines with no separate IR.
 * Usage: pnpm --filter api code:backtest
 */
const START = '20200101';
const END = '20241231';
const CASH = 1_000_000;

// EP monthly decile, authored against the SDK — mirrors crossSectionStrategy({ signal:'ep', side:'high', q:0.1 }).
const EP_CODE = `
let last = '';
export default defineStrategy({
  name: 'EP 月度十分位',
  async onBar(ctx) {
    if (ctx.period('monthly') === last) return;
    last = ctx.period('monthly');
    const picks = (await ctx.universe())
      .minListDays(365)
      .where(b => b.peTtm != null && b.peTtm > 0)
      .dropBottom(0.25, b => b.turnoverRate ?? 0)
      .rankBy(b => 1 / b.peTtm, 'desc')
      .top(0.1);
    if (picks.length) ctx.equalWeight(picks);
  },
});
`;

function line(label: string, r: BacktestResult): string {
  return `${label}: return ${pct(r.totalReturn)} | annualized ${pct(r.annReturn)} | Sharpe ${r.sharpe.toFixed(
    2,
  )} | drawdown ${pct(r.maxDrawdown)} | trades ${r.trades}`;
}

async function main(): Promise<void> {
  const ir = await runStrategy({
    start: START,
    end: END,
    initialCash: CASH,
    strategy: crossSectionStrategy({ signal: 'ep', side: 'high', quantile: 0.1 }),
  });
  const code = await runCodeBacktest({ start: START, end: END, initialCash: CASH, code: EP_CODE });

  console.log('\n=== EP monthly decile · IR version vs code version (SDK stdlib) ===');
  console.log(line('IR  ', ir));
  console.log(line('Code', code));
  const same = Math.abs(ir.totalReturn - code.totalReturn) < 1e-9 && ir.trades === code.trades;
  console.log(
    same
      ? '\n✅ Both versions match bit-for-bit —— the SDK stdlib faithfully expresses the structured strategy'
      : '\n❌ Mismatch, needs investigation',
  );
  if (!same) {
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
