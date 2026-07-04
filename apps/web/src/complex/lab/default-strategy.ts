/** The starter strategy in a fresh editor — a neutral, empty skeleton (not a pre-made strategy). It's
 * what the Agent sees as "current code" on the first turn, so the agent writes from scratch instead of
 * treating a demo strategy as the user's own. The user can also hand-write here; the SDK reference lives
 * in /docs. A short commented example points at the cross-section chain without cluttering the canvas. */
export const DEFAULT_CODE = `// 在左侧用 Agent 描述你想要的策略，生成的代码会写在这里；也可以直接在这里改。
export default defineStrategy({
  name: '新策略',
  onBar(ctx) {
    // 引擎每个交易日调用一次：用 ctx 读数据、下单（T+1 / 涨跌停 / 复权 / 成本由引擎背后处理）
  },
});

// 例：单只 MA20 突破 —— watch: ['600519.SH']；上穿 20 日线满仓、下穿清仓
// 例：全市场横截面 —— (await ctx.universe()).rankBy(b => 1 / b.peTtm).top(0.1) 再 ctx.equalWeight(picks)
`;
