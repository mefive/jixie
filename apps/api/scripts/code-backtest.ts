import { prisma } from '../src/lib/prisma.js';
import { runCodeBacktest } from '../src/strategy/code/run.js';

const pct = (x: number) => (x * 100).toFixed(2) + '%';
const yuan = (v: number) => '¥' + Math.round(v).toLocaleString();

/**
 * Proof of the code-first loop: a strategy authored as a TS *string* (exactly what a user types in the
 * editor) is compiled and run through the same engine the IR used.
 * Usage: pnpm --filter api code:backtest
 */
const CODE = `
export default defineStrategy({
  name: 'MA20 突破 · 茅台',
  watch: ['600519.SH'],
  onBar(ctx) {
    const code = '600519.SH';
    const px = ctx.price(code);
    const win = ctx.history(code, 'close', 20);
    if (px == null || win.length < 20) return;
    const ma = win.reduce((a, b) => a + b, 0) / win.length;
    if (px > ma && ctx.shares(code) === 0) ctx.order(code, Math.floor(ctx.cash / px));
    else if (px < ma && ctx.shares(code) > 0) ctx.exit(code);
  },
});
`;

async function main(): Promise<void> {
  const r = await runCodeBacktest(
    { start: '20220101', end: '20241231', initialCash: 1_000_000, code: CODE },
    (line) => console.log('  ·', line),
  );
  console.log('\n=== 代码策略回测结果 ===');
  console.log(
    `收益 ${pct(r.totalReturn)} | 年化 ${pct(r.annReturn)} | Sharpe ${r.sharpe.toFixed(2)} | 回撤 ${pct(
      r.maxDrawdown,
    )} | 交易 ${r.trades} 笔 | 期末 ${yuan(r.finalValue)}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
