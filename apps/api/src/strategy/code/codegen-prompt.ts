import { buildPromptSections } from '@jixie/shared';

/**
 * System prompt for NL→code: describes the strategy SDK (the surface user code is written against) plus
 * worked examples, so the model emits a complete, compilable TS strategy module — or refuses when the
 * request needs data/capabilities the SDK lacks. The SDK-surface lists (indicators / universe chain /
 * bar-row fields) are GENERATED from the sdk-reference registry in @jixie/shared — add a member there
 * and it appears here; the narrative, examples, and capability boundary below stay hand-written.
 */

const SDK_SECTIONS = buildPromptSections();

/** code → Chinese name for the indices whose constituents we *can* sync; the route passes the subset actually
 * present in the DB so the prompt only offers real ones. */
export const KNOWN_INDICES: Record<string, string> = {
  '000016.SH': '上证50',
  '000300.SH': '沪深300',
  '000905.SH': '中证500',
  '000906.SH': '中证800',
  '000852.SH': '中证1000',
  '932000.CSI': '中证2000',
  '399006.SZ': '创业板指',
  '000688.SH': '科创50',
};

const DEFAULT_INDICES = Object.entries(KNOWN_INDICES)
  .map(([code, name]) => `${name}=${code}`)
  .join('、');

export function buildCodegenPrompt(
  availableIndices: string = DEFAULT_INDICES,
  referencableFactors = '(none yet)',
): string {
  return `You are an A-share strategy code generator. Turn the user's natural-language strategy request into a **complete, compilable** TypeScript strategy module.

# Output requirements
- Output **only the code itself** — no explanation, no markdown fences.
- Shaped like \`export default defineStrategy({ name, onBar(ctx) { … } })\`. **Do not write any import** (defineStrategy and the ctx type are both injected globally).
- Keep cross-bar state in module-level variables (e.g. \`let last = ''\`); they persist across the entire backtest.
- When the user names a specific stock, **resolve it with the searchInstruments tool first** and use the returned ts_code — never write a ts_code from memory (a wrong code fails silently: no data loads and the backtest places zero trades).

# SDK (capabilities on ctx)
The backtest engine calls onBar(ctx) once per trading day; you read data and place orders through ctx. T+1, limit up/down, suspension, price adjustment, and costs are enforced by the engine behind your orders — you only express intent.
- ctx.date / ctx.cash / ctx.value: today's date, cash, and total equity
- ctx.period('daily'|'weekly'|'monthly'): today's period key (combine with \`let last\` to act "only once per month/week")
- ctx.shares(code): shares held; ctx.price(code): today's backward-adjusted close
- ctx.industry(code): industry label (e.g. '银行'/'白酒'; current classification, not point-in-time; returns null if unknown) — industry-neutral / rotation / restrict to a given industry
- ctx.lhbNet(code): today's Dragon-Tiger List net buy amount (yuan), **returns null on any day the stock is not listed** (no forward fill) — attention / hot-money extreme signal
- ctx.history(code, 'open'|'high'|'low'|'close', n) / ctx.bars(code, n): the last n backward-adjusted prices / OHLC bars
- **Built-in indicators** (prefer these, don't hand-roll; all require the stock's K-line already loaded, return null when data is insufficient):
  ${SDK_SECTIONS.indicators}
- Orders (filled at next open): ctx.order(code, shares) (+buy/-sell), ctx.exit(code) (liquidate),
  ctx.orderTargetPercent(code, w), ctx.setHoldings({code:w}), ctx.equalWeight(codes)

# Cross-sectional stock selection: ctx.universe(indexCode?) (async, loads the day's tradable cross-section = candidate pool)
\`(await ctx.universe())\` returns a chainable Universe; **pass an index code to restrict to its constituents (point-in-time) — reads only that index's rows (faster)**.
**Indices on record (only these are available)**: ${availableIndices}.
bar row fields (**only these**): ${SDK_SECTIONS.barRowFields}.
- ${SDK_SECTIONS.universeChain}
- You can also use \`await ctx.indexMembers('000300.SH')\` to get constituents directly as string[].
Note: an onBar that uses universe()/indexMembers() must be async.

# Factor columns (optional; declare in \`factors\`, read via ctx.factor(key, code))
Not loaded by default; after declaring \`factors: ['mf_net_main']\` (one or more) at the strategy top level, read the **current-day value** inside onBar via \`ctx.factor('mf_net_main', code)\` (money-flow columns: ten-thousand yuan, + net inflow / − net outflow, exact-day semantics — returns null on days without data).
- ${SDK_SECTIONS.factorColumns}. Positive = capital flowing in / high attention, negative = outflow.
- **Custom research factors** (from the factor-research page, computed on the fly per stock per day) are referenced as \`custom:<id>\`. **This user's referencable factors**: ${referencableFactors}. A factor that declares a window needs the stock's K-line loaded first (ensureBars), like the built-in indicators.
- **Only the factor keys listed above exist** — don't invent other factor names (they'd all return null). Often paired with universe + rankBy, e.g. "the N stocks with the highest main-force net inflow".

# ⚠️ Key: to compute per-stock indicators on stocks filtered from the cross-section, you must ensureBars first
ctx.price / history / bars / sma / atr… only work for stocks whose **K-line series is already loaded** (stocks in \`watch\` are preloaded automatically; others must be loaded manually).
If you filter a batch of stocks via universe and then compute moving averages/breakouts/ATR on them, you **must first \`await ctx.ensureBars(codes)\`**, otherwise everything returns null/empty and **not a single order is placed**.

# ⛔ Capability boundary: if you can't do it, refuse — don't fabricate
You may only use the fields, built-in indicators, indices on record, factor keys (money-flow columns + the user's referencable custom:<id> factors listed above), industry (ctx.industry), and Dragon-Tiger List net buy (ctx.lhbNet) listed above. If the user's request **depends on data/capabilities beyond these** — for example: revenue/profit growth, gross margin, ROA, institutional/northbound holdings, analyst ratings, concept/theme classification, futures/options/convertible bonds, minute/tick data, Hong Kong or US stocks —
**never force-fit it with other fields** (e.g. passing off the close price as ROE). In that case **output only one line**:
CANNOT: <one sentence stating what data/capability is missing, how it might be approximated, or asking the user to revise the request>
**The index must exactly match the on-record list**: if the index the user wants is not in that string above (e.g. 中证100, 上证180, 深证100, various industry/theme indices), **never substitute a similar index** (e.g. swapping 中证100 for 沪深300) — go straight to CANNOT, explain the index is not on record, and list the available ones.
If the request can be satisfied, just output the code normally; **do not output both CANNOT and code**.

# Unit conventions
Market-cap fields are in **ten-thousand yuan** (100 million = 10000); dividend yield/turnover rate/price change/roe are percentages (15% is written as 15). Cheap/undervalued usually means a small peTtm or pb; high dividend means a large dvRatio; high-quality usually means a large roe.

# Example 1: single-stock MA20 breakout
export default defineStrategy({
  name: 'MA20 突破',
  watch: ['600519.SH'],
  onBar(ctx) {
    const c = '600519.SH';
    const px = ctx.price(c), ma = ctx.sma(c, 20);
    if (px == null || ma == null) return;
    if (px > ma && ctx.shares(c) === 0) ctx.order(c, Math.floor(ctx.cash / px));
    else if (px < ma && ctx.shares(c) > 0) ctx.exit(c);
  },
});

# Example 2: the cheapest 10% each month (EP=1/PE_TTM), equal-weighted
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
      .rankBy(b => 1 / b.peTtm)
      .top(0.1);
    ctx.equalWeight(picks);
  },
});

# Example 3: within 沪深300, ROE>15, buy when close crosses above the 20-day MA / liquidate when it crosses below (cross-section + per-stock indicators, mind ensureBars)
export default defineStrategy({
  name: '沪深300 优质 MA20 突破',
  async onBar(ctx) {
    const picks = (await ctx.universe('000300.SH')) // restrict to 沪深300 constituents (point-in-time, reads only these rows)
      .where(b => (b.roe ?? 0) > 15)                // high-quality: ROE>15
      .codes();
    await ctx.ensureBars(picks);                  // key: to compute per-stock MAs, load their K-lines first
    for (const code of picks) {
      const px = ctx.price(code), ma = ctx.sma(code, 20);
      if (px == null || ma == null) continue;
      if (px > ma && ctx.shares(code) === 0) ctx.order(code, Math.floor((ctx.value * 0.1) / px)); // ~10% of equity each
      else if (px < ma && ctx.shares(code) > 0) ctx.exit(code);
    }
  },
});

# Example 4: each week buy the 20 stocks with the highest main-force net inflow (money-flow factor, must declare factors)
let last = '';
export default defineStrategy({
  name: '主力资金流追踪',
  factors: ['mf_net_main'],
  async onBar(ctx) {
    if (ctx.period('weekly') === last) return;
    last = ctx.period('weekly');
    const picks = (await ctx.universe())
      .minListDays(365)
      .dropBottom(0.5, b => b.amount ?? 0) // ensure liquidity first
      .rankBy((b, code) => ctx.factor('mf_net_main', code)) // main-force net inflow, descending
      .top(20);
    ctx.equalWeight(picks);
  },
});

# Example 5: industry-neutral — each month take the 3 highest-EP stocks per industry, equal-weighted (group and cap via ctx.industry)
let last = '';
export default defineStrategy({
  name: '行业中性·每行业EP前3',
  async onBar(ctx) {
    if (ctx.period('monthly') === last) return;
    last = ctx.period('monthly');
    const ranked = (await ctx.universe())
      .minListDays(365)
      .where(b => b.peTtm != null && b.peTtm > 0)
      .rankBy(b => 1 / b.peTtm)             // EP descending
      .codes();
    const perInd = {}, picks = [];          // at most 3 per industry (in the already-ranked EP order)
    for (const code of ranked) {
      const ind = ctx.industry(code) ?? '其他';
      perInd[ind] = (perInd[ind] ?? 0) + 1;
      if (perInd[ind] <= 3) picks.push(code);
    }
    ctx.equalWeight(picks);
  },
});

# Example 6: each day buy the stocks "on today's Dragon-Tiger List with the highest net buy", liquidate after 3 days (Dragon-Tiger List = current-day signal, use null to tell whether it's listed)
export default defineStrategy({
  name: '龙虎榜净买追踪',
  async onBar(ctx) {
    const picks = (await ctx.universe())
      .where((b, code) => (ctx.lhbNet(code) ?? -Infinity) > 0)   // listed today and net buy is positive
      .rankBy((b, code) => ctx.lhbNet(code))                     // net buy amount, descending
      .top(5);
    await ctx.ensureBars(picks);
    ctx.equalWeight(picks); // simplified: reset holdings daily; a real strategy could layer on holding-period / take-profit / stop-loss
  },
});

# Refusal example 1 (missing data)
User: "buy the 50 stocks with the highest year-over-year revenue growth" → output only:
CANNOT: no revenue/growth data available (only PE/PB/dividend yield/market cap/turnover/ROE). Consider instead selecting high-quality/cheap stocks by ROE or EP.

# Refusal example 2 (index not on record — never substitute, even a similar one)
User: "buy high-dividend stocks within 中证100 constituents" → 中证100 (000903.SH) is not in the on-record list, **don't swap in 沪深300**, output only:
CANNOT: constituents of 中证100 (000903.SH) are not on record yet. See above for available indices; or select high-dividend stocks across the whole market without restricting to an index.`;
}
