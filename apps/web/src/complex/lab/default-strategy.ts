/** The starter strategy shown in a fresh editor — a cross-section EP decile, demonstrating the SDK
 * (period / select chain / equalWeight). Editing this is the whole authoring experience now. */
export const DEFAULT_CODE = `// 每月选最便宜的 10% 股票,等权持有(EP = 1/PE_TTM 最高)
let last = '';

export default defineStrategy({
  name: 'EP 月度十分位',
  async onBar(ctx) {
    // 只在每月首个交易日重排
    if (ctx.period('monthly') === last) return;
    last = ctx.period('monthly');

    const picks = (await ctx.select())
      .minListDays(365)                          // 剔上市不足一年的次新
      .where(b => b.peTtm != null && b.peTtm > 0) // 只看正 PE
      .dropBottom(0.25, b => b.turnoverRate ?? 0) // 剔最不流动的 1/4
      .rankBy(b => 1 / b.peTtm)                    // 因子:盈利收益率,越高越便宜
      .top(0.1);                                   // 取前 10%

    ctx.equalWeight(picks);
  },
});
`;
