import type { BarContext, BarRow, Strategy } from '../../engine/types.js';

/**
 * The strategy SDK — what user code is written against. Full code-first: a strategy is just
 * `export default defineStrategy({ onBar(ctx) { … } })`, and the structured operations that used to be
 * IR stages (schedule / select / sizing) are now one-line *library* calls on `ctx`, not a parallel
 * representation. So the boilerplate stays gone, but there's a single source of truth — the code.
 *
 * `enrich` layers these helpers onto the engine's core BarContext, so the engine stays lean (raw market
 * primitives + order intents) and the sugar lives here. Authoring is import-free: `defineStrategy` and
 * the StrategyCtx type are injected ambients (a .d.ts gives Monaco the same surface).
 */

export type Schedule = 'daily' | 'weekly' | 'monthly';

/** What user code sees each bar: the engine primitives (BarContext) + the SDK helpers below. */
export interface StrategyCtx extends BarContext {
  /** Period key for today on a schedule — compare to your own `let last` to fire once per period:
   * `if (ctx.period('monthly') === last) return; last = ctx.period('monthly');` */
  period(schedule: Schedule): string;
  /** Today's tradable universe as a chainable selection (loads the cross-section; bar() valid after).
   * Pass an index code (e.g. '000300.SH' 沪深300) to restrict to its point-in-time constituents — the
   * restriction is pushed into the data load (only those rows are read), not filtered in memory after. */
  universe(indexCode?: string): Promise<Universe>;
  /** Equal-weight the given codes (a target-book rebalance at next open). */
  equalWeight(codes: string[]): void;

  // —— 内置技术指标(都需要该票的 K 线已加载:watch 预载 或 ensureBars;数据不足返 null)——
  /** n 日简单均线(SMA)= 最近 n 根收盘价的算术平均。趋势/均线策略的基础。 */
  sma(code: string, n: number): number | null;
  /** n 日指数均线(EMA):也是均线,但越近的价格权重越大,比 SMA 更快跟随价格。 */
  ema(code: string, n: number): number | null;
  /** n 日 ATR(平均真实波幅):衡量这只票近期「一天能波动多大」,常用来定止损距离 / 仓位。需 n+1 根。 */
  atr(code: string, n: number): number | null;
  /** 最近 n 根在某字段上的最高值(唐奇安上轨)—— 价格突破它常作为「入场」信号。 */
  highest(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number | null;
  /** 最近 n 根在某字段上的最低值(唐奇安下轨)—— 价格跌破它常作为「出场」信号。 */
  lowest(code: string, field: 'open' | 'high' | 'low' | 'close', n: number): number | null;
  /** n 日平均成交额(千元)—— 衡量流动性(能不能买得进卖得出),常用作选股的滑点/流动性门槛。 */
  avgAmount(code: string, n: number): number | null;
  /** n 日平均成交量(手)—— 同样衡量活跃度 / 流动性。 */
  avgVol(code: string, n: number): number | null;
}

export interface CodeStrategy {
  name?: string;
  /** Precomputed factor columns to preload (price-window signals like mom/rev/vol). */
  factors?: string[];
  /** Instruments to preload bar series for up front (per-instrument systems read bars()/price()). */
  watch?: string[];
  onBar(ctx: StrategyCtx): void | Promise<void>;
}

/** Today's universe as a chainable view over codes — filter, rank, take a slice. Each step returns a new
 * Universe (immutable); the terminal `top`/`codes` returns plain string[]. The candidate pool the engine
 * recomputes each bar (cf. industry "universe selection"): `(await ctx.universe('000300.SH'))
 * .minListDays(365).rankBy(b => 1/b.peTtm!).top(0.1)`. The index restriction (if any) was pushed into the
 * data load; `where`/`rankBy`/etc. refine the loaded panel in memory. */
export class Universe {
  constructor(
    private readonly ctx: BarContext,
    private readonly list: string[],
  ) {}

  /** Keep codes whose today-row passes the predicate. */
  where(predicate: (bar: BarRow, code: string) => boolean): Universe {
    return new Universe(
      this.ctx,
      this.list.filter((code) => {
        const bar = this.ctx.bar(code);
        return bar != null && predicate(bar, code);
      }),
    );
  }

  /** Keep codes listed at least `days` calendar days (point-in-time stock age). */
  minListDays(days: number): Universe {
    return new Universe(
      this.ctx,
      this.list.filter((code) => {
        const age = this.ctx.listDays(code);
        return age == null || age >= days;
      }),
    );
  }

  /** Drop the bottom `fraction` by `score` (e.g. liquidity: `dropBottom(0.25, b => b.turnoverRate ?? 0)`). */
  dropBottom(fraction: number, score: (bar: BarRow, code: string) => number): Universe {
    const scored = this.list.map((code) => ({ code, value: this.scoreOrBottom(code, score) }));
    scored.sort((lower, higher) => lower.value - higher.value);
    return new Universe(
      this.ctx,
      scored.slice(Math.floor(scored.length * fraction)).map((entry) => entry.code),
    );
  }

  /** Rank by a score (codes scoring null are dropped). `direction` 'desc' = highest first (default). */
  rankBy(
    score: (bar: BarRow, code: string) => number | null,
    direction: 'desc' | 'asc' = 'desc',
  ): Universe {
    const scored = this.list
      .map((code) => {
        const bar = this.ctx.bar(code);
        return { code, value: bar != null ? score(bar, code) : null };
      })
      .filter(
        (entry): entry is { code: string; value: number } =>
          entry.value != null && Number.isFinite(entry.value),
      );
    scored.sort((lower, higher) =>
      direction === 'desc' ? higher.value - lower.value : lower.value - higher.value,
    );
    return new Universe(
      this.ctx,
      scored.map((entry) => entry.code),
    );
  }

  /** Take the leading slice: a fraction when `n < 1` (0.1 = top decile, min 1), else a count. */
  top(n: number): string[] {
    // n < 1 → 取比例(0.1 = 前 10%,至少 1 只);n ≥ 1 → 取个数
    const count = n < 1 ? Math.max(1, Math.floor(this.list.length * n)) : Math.floor(n);
    return this.list.slice(0, count);
  }

  /** The current codes (after any chained steps). */
  codes(): string[] {
    return this.list;
  }

  get length(): number {
    return this.list.length;
  }

  // Score a code via its today-row; a code with no row scores -Infinity so it sorts to the bottom.
  private scoreOrBottom(code: string, score: (bar: BarRow, code: string) => number): number {
    const bar = this.ctx.bar(code);
    return bar != null ? score(bar, code) : -Infinity;
  }
}

/** Identity-with-types factory for a code strategy; wraps onBar so it receives the enriched ctx. The
 * code loader injects THIS as the `defineStrategy` ambient. */
export function defineStrategy(s: CodeStrategy): Strategy {
  return {
    name: s.name ?? '未命名策略',
    factors: s.factors,
    watch: s.watch,
    onBar: (core: BarContext) => s.onBar(enrich(core)),
  };
}

/** Layer the SDK helpers onto the engine's per-bar core ctx. */
export function enrich(ctx: BarContext): StrategyCtx {
  const enriched = ctx as StrategyCtx;
  enriched.period = (schedule) => periodKey(ctx.date, schedule);
  // The index restriction is pushed into the data load (loadCrossSection only reads those rows), not
  // filtered in memory here — so 沪深300 reads ~300 rows, not the full ~5370. See engine/data crossSection.
  enriched.universe = async (indexCode?: string) =>
    new Universe(ctx, await ctx.loadCrossSection(indexCode));
  enriched.equalWeight = (codes) => {
    const weight = codes.length ? 1 / codes.length : 0;
    const targets: Record<string, number> = {};
    for (const code of codes) {
      targets[code] = weight;
    }
    ctx.setHoldings(targets);
  };
  enriched.sma = (code, n) => {
    const closes = ctx.history(code, 'close', n);
    return closes.length < n ? null : closes.reduce((sum, close) => sum + close, 0) / n;
  };
  enriched.ema = (code, n) => {
    const closes = ctx.history(code, 'close', n * 4); // 多取几倍窗口给 EMA 预热
    if (closes.length < n) {
      return null;
    }
    const alpha = 2 / (n + 1); // 平滑系数:越大越看重近端(近端权重 = alpha)
    let ema = closes[0];
    for (const close of closes.slice(1)) {
      ema = close * alpha + ema * (1 - alpha);
    }
    return ema;
  };
  enriched.highest = (code, field, n) => {
    const series = ctx.history(code, field, n);
    return series.length < n ? null : Math.max(...series);
  };
  enriched.lowest = (code, field, n) => {
    const series = ctx.history(code, field, n);
    return series.length < n ? null : Math.min(...series);
  };
  enriched.atr = (code, n) => {
    const bars = ctx.bars(code, n + 1);
    if (bars.length < n + 1) {
      return null;
    }
    // True Range = max(高−低, |高−昨收|, |低−昨收|);ATR = 最近 n 根 TR 的均值
    let trueRangeSum = 0;
    for (let barIndex = bars.length - n; barIndex < bars.length; barIndex++) {
      const bar = bars[barIndex];
      const prevClose = bars[barIndex - 1].adjClose;
      trueRangeSum += Math.max(
        bar.adjHigh - bar.adjLow,
        Math.abs(bar.adjHigh - prevClose),
        Math.abs(bar.adjLow - prevClose),
      );
    }
    return trueRangeSum / n;
  };
  enriched.avgAmount = (code, n) => avgField(ctx.bars(code, n), n, (bar) => bar.amount);
  enriched.avgVol = (code, n) => avgField(ctx.bars(code, n), n, (bar) => bar.vol);
  return enriched;
}

/** Mean of a per-bar field over the window, or null if fewer than n valid values. */
function avgField(
  bars: { amount: number | null; vol: number | null }[],
  n: number,
  pick: (bar: { amount: number | null; vol: number | null }) => number | null,
): number | null {
  const values = bars.map(pick).filter((value): value is number => value != null);
  return values.length < n ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Period bucket for a schedule — a new key means a new period (rebalance boundary). */
export function periodKey(date: string, schedule: Schedule): string {
  if (schedule === 'monthly') {
    return date.slice(0, 6);
  } // YYYYMM
  if (schedule === 'weekly') {
    // 把日期换算成「自 epoch 起的第几天」(epochDay),整除 7 得周序号 —— 跨月/跨年也连续不断
    const epochDay =
      Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8)) / 86_400_000;
    return String(Math.floor(epochDay / 7));
  }
  return date; // daily: 每个交易日自成一个 key
}
