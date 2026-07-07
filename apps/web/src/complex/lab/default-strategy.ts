/** The starter strategy in a fresh editor — a neutral, empty skeleton (not a pre-made strategy). It's
 * what the Agent sees as "current code" on the first turn, so the agent writes from scratch instead of
 * treating a demo strategy as the user's own. The user can also hand-write here; the SDK reference lives
 * in /docs. A short commented example points at the cross-section chain without cluttering the canvas. */
export const DEFAULT_CODE = `// Describe the strategy you want to the Agent on the left; the generated code lands here. You can also edit it directly.
export default defineStrategy({
  name: 'New strategy',
  onBar(ctx) {
    // Called once per trading day: use ctx to read data and place orders (T+1 / price limits / adjustment / costs are handled by the engine).
  },
});

// Example — single-name MA20 breakout: watch: ['600519.SH']; go full on a cross above the 20-day MA, liquidate on a cross below.
// Example — whole-market cross-section: (await ctx.universe()).rankBy(b => 1 / b.peTtm).top(0.1), then ctx.equalWeight(picks).
`;
