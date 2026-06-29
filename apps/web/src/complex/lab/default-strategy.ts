/** The starter strategy in a fresh editor. A single-name MA20 breakout — sub-second to backtest, so the
 * first 运行回测 returns instantly. The commented block shows the cross-section SDK (universe chain) for
 * whole-market strategies (those load the full panel each rebalance, so they run slower). */
export const DEFAULT_CODE = `// MA20 突破:收盘价上穿 20 日均线满仓买入、下穿清仓(单只,秒级回测)
export default defineStrategy({
  name: 'MA20 突破 · 贵州茅台',
  watch: ['600519.SH'],
  onBar(ctx) {
    const code = '600519.SH';
    const px = ctx.price(code);
    const win = ctx.history(code, 'close', 20);
    if (px == null || win.length < 20) return;

    const ma20 = win.reduce((a, b) => a + b, 0) / win.length;
    if (px > ma20 && ctx.shares(code) === 0) ctx.order(code, Math.floor(ctx.cash / px));
    else if (px < ma20 && ctx.shares(code) > 0) ctx.exit(code);
  },
});

// 想做全市场横截面选股?用 ctx.universe() 链 —— 例如每月取最便宜的 10%(EP=1/PE_TTM)等权:
//
// let last = '';
// export default defineStrategy({
//   name: 'EP 月度十分位',
//   async onBar(ctx) {
//     if (ctx.period('monthly') === last) return;
//     last = ctx.period('monthly');
//     const picks = (await ctx.universe())
//       .minListDays(365)
//       .where(b => b.peTtm != null && b.peTtm > 0)
//       .dropBottom(0.25, b => b.turnoverRate ?? 0)
//       .rankBy(b => 1 / b.peTtm)
//       .top(0.1);
//     ctx.equalWeight(picks);
//   },
// });
`;
