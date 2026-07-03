import { FACTORS, FUNDAMENTAL_FACTORS } from '../factor/factors.js';
import type { BarContext, BarRow, OhlcBar, Strategy } from './types.js';

/** Identity helper — gives a strategy object its type + a place to hang a name. */
export function defineStrategy(s: Strategy): Strategy {
  return s;
}

/**
 * A ranking signal: maps today's row (+ context) to a number the strategy sorts on, or null to skip.
 * This is where "what is a factor" lives — on the strategy side, not in the engine.
 */
export type Signal = (bar: BarRow, ctx: BarContext, code: string) => number | null;

interface SignalDef {
  label: string;
  fn: Signal;
}

// Bars to pull for a price-window signal — must cover the longest lookback (momentum 60 + skip) + 1.
const PRICE_FACTOR_BARS = 70;

/**
 * Signal registry — the menu a config-driven UI would expose.
 *  - Valuation signals (ep/bp/dv/size) read bar() straight from daily_basic (point-in-time, no
 *    precompute). They reuse the exact formulas in factors.ts so there's a single source of truth.
 *  - Price-window signals (mom/rev/vol) compute on the fly from the bar series via the same factors.ts
 *    formulas — no precompute, no factor store (the engine holds no factor values).
 */
export const SIGNALS: Record<string, SignalDef> = {
  ...Object.fromEntries(
    FUNDAMENTAL_FACTORS.map((f) => [f.key, { label: f.label, fn: (b: BarRow) => f.from(b) }]),
  ),
  ...Object.fromEntries(
    FACTORS.map((f) => [
      f.key,
      {
        label: f.label,
        fn: (_b: BarRow, ctx: BarContext, code: string) => {
          const bars = ctx.bars(code, PRICE_FACTOR_BARS);
          if (bars.length < 2) {
            return null;
          }
          return f.fn(
            bars.map((x) => x.adjClose),
            bars.map((x) => x.date),
            bars.length - 1,
          );
        },
      },
    ]),
  ),
};

/**
 * Config-driven cross-sectional strategy (the bridge to a future web form: these options are exactly
 * what it would collect). Rebalances on the first trading day of each month — detected in onBar by
 * watching for a month change (the engine has no built-in schedule). Each rebalance: take the
 * tradable universe, drop recently-listed and the least liquid names (point-in-time), rank the rest
 * by `signal`, and equal-weight the top/bottom `quantile` slice.
 *   side 'low'  → hold the lowest-signal names (e.g. low-volatility, smallest size)
 *   side 'high' → hold the highest-signal names (e.g. cheapest by earnings yield)
 */
export function crossSectionStrategy(opts: {
  signal: string;
  side: 'low' | 'high';
  quantile: number; // 0.1 = top/bottom decile
  minListDays?: number; // exclude stocks listed less than this many calendar days ago (default 365)
  liquidityDrop?: number; // drop this bottom fraction by turnover (default 0.25)
  name?: string;
}): Strategy {
  const sig = SIGNALS[opts.signal];
  if (!sig) {
    throw new Error(`未知信号 "${opts.signal}"，可选：${Object.keys(SIGNALS).join(' / ')}`);
  }
  const minListDays = opts.minListDays ?? 365;
  const liquidityDrop = opts.liquidityDrop ?? 0.25;
  let lastMonth = '';

  return {
    name: opts.name ?? `${opts.signal}-${opts.side}-q${opts.quantile}`,
    async onBar(ctx) {
      const month = ctx.date.slice(0, 6);
      if (month === lastMonth) {
        return;
      } // already rebalanced this month
      lastMonth = month;

      const codes = await ctx.loadCrossSection();
      await ctx.ensureBars(codes); // price-window signals compute from the bar series → need it cached
      let cands: { code: string; v: number; liq: number }[] = [];
      for (const code of codes) {
        const bar = ctx.bar(code);
        if (!bar) {
          continue;
        }
        const age = ctx.listDays(code);
        if (age != null && age < minListDays) {
          continue;
        } // exclude recently-listed (point-in-time)
        const v = sig.fn(bar, ctx, code);
        if (v == null || !Number.isFinite(v)) {
          continue;
        }
        cands.push({ code, v, liq: bar.turnoverRate ?? 0 });
      }
      if (cands.length < 20) {
        return;
      }

      // Liquidity filter: drop the least-traded fraction.
      cands.sort((a, b) => a.liq - b.liq);
      cands = cands.slice(Math.floor(cands.length * liquidityDrop));

      // Rank by signal (ascending) and take one tail.
      cands.sort((a, b) => a.v - b.v);
      const k = Math.max(1, Math.floor(cands.length * opts.quantile));
      const picks = opts.side === 'low' ? cands.slice(0, k) : cands.slice(-k);

      const w = 1 / picks.length;
      const targets: Record<string, number> = {};
      for (const p of picks) {
        targets[p.code] = w;
      }
      ctx.setHoldings(targets);
    },
  };
}

// —— Turtle Trading (海龟交易法则) —————————————————————————————————————————————

/** Wilder N (volatility unit) = average True Range over the window. Needs window+1 bars. */
function atr(bars: OhlcBar[], window: number): number | null {
  if (bars.length < window + 1) {
    return null;
  }
  let sum = 0;
  for (let i = bars.length - window; i < bars.length; i++) {
    const prevClose = bars[i - 1].adjClose;
    const tr = Math.max(
      bars[i].adjHigh - bars[i].adjLow,
      Math.abs(bars[i].adjHigh - prevClose),
      Math.abs(bars[i].adjLow - prevClose),
    );
    sum += tr;
  }
  return sum / window;
}

/** Highest high over the `window` bars *before* today (the Donchian entry channel). */
function priorHigh(bars: OhlcBar[], window: number): number | null {
  if (bars.length < window + 1) {
    return null;
  }
  let h = -Infinity;
  for (let i = bars.length - 1 - window; i < bars.length - 1; i++) {
    h = Math.max(h, bars[i].adjHigh);
  }
  return h;
}

/** Lowest low over the `window` bars *before* today (the Donchian exit channel). */
function priorLow(bars: OhlcBar[], window: number): number | null {
  if (bars.length < window + 1) {
    return null;
  }
  let l = Infinity;
  for (let i = bars.length - 1 - window; i < bars.length - 1; i++) {
    l = Math.min(l, bars[i].adjLow);
  }
  return l;
}

interface TurtleState {
  units: number; // 0 = flat
  unitShares: number; // shares per unit, fixed at first entry
  n: number; // ATR at entry (the volatility unit for adds/stop)
  addAbove: number; // add another unit once close ≥ this level
  stop: number; // exit once close ≤ this level
}

/**
 * Turtle Trading — System 1, long-only (A-share adaptation: no individual-stock shorting).
 *
 * Per instrument, on each daily close:
 *   entry (flat):   close breaks above the prior `entryDonchian`-day high → buy 1 unit next open
 *   sizing:         unit = floor(riskUnitPct × equity / N), N = `atrWindow`-day ATR — equal *risk*,
 *                   so volatile names get fewer shares (the Turtle innovation)
 *   pyramiding:     each further +½N in price adds another unit, up to `maxUnits`
 *   stop:           close ≤ entry − `stopN`×N exits everything; the stop trails up on each add
 *   exit:           close breaks below the prior `exitDonchian`-day low exits everything
 *
 * Daily-bar simplifications (documented, not hidden): signals computed on the close, filled at the
 * next open (no look-ahead); stops are evaluated on the close, not intraday; ATR is a simple average;
 * add/stop levels are tracked in close-space (the order's actual fill price may differ slightly);
 * buys are capped by available cash (a long-only cash account can't leverage like the futures original).
 */
export function turtleStrategy(opts: {
  codes: string[];
  entryDonchian?: number; // breakout lookback for entries (default 20)
  exitDonchian?: number; // breakout lookback for exits (default 10)
  atrWindow?: number; // ATR/N window (default 20)
  stopN?: number; // stop distance in N (default 2)
  addHalfN?: number; // add-a-unit step in N (default 0.5)
  maxUnits?: number; // max pyramided units (default 4)
  riskUnitPct?: number; // equity fraction risked per unit (default 0.01)
  unitCapPct?: number; // max equity fraction of notional per unit (default 0.10) — caps concentration
  name?: string;
}): Strategy {
  const entryDonchian = opts.entryDonchian ?? 20;
  const exitDonchian = opts.exitDonchian ?? 10;
  const atrWindow = opts.atrWindow ?? 20;
  const stopN = opts.stopN ?? 2;
  const addHalfN = opts.addHalfN ?? 0.5;
  const maxUnits = opts.maxUnits ?? 4;
  const riskUnitPct = opts.riskUnitPct ?? 0.01;
  const unitCapPct = opts.unitCapPct ?? 0.1;
  const need = Math.max(entryDonchian, exitDonchian, atrWindow) + 1;
  const state = new Map<string, TurtleState>(); // per-code position state (closure)

  return {
    name: opts.name ?? `turtle-${entryDonchian}/${exitDonchian}`,
    watch: opts.codes,
    onBar(ctx) {
      for (const code of opts.codes) {
        const bars = ctx.bars(code, need);
        if (bars.length < need) {
          continue;
        } // warming up
        const close = bars[bars.length - 1].adjClose;
        const st = state.get(code);

        if (!st || st.units === 0) {
          // Flat: enter on an upside Donchian breakout.
          const hi = priorHigh(bars, entryDonchian);
          const n = atr(bars, atrWindow);
          if (hi == null || n == null || n <= 0 || close <= hi) {
            continue;
          }
          // Equal-risk size, capped so one unit can't exceed unitCapPct of equity (low-vol names).
          const riskShares = (riskUnitPct * ctx.value) / n;
          const capShares = (unitCapPct * ctx.value) / close;
          const unitShares = Math.floor(Math.min(riskShares, capShares));
          if (unitShares <= 0) {
            continue;
          }
          ctx.order(code, unitShares);
          state.set(code, {
            units: 1,
            unitShares,
            n,
            addAbove: close + addHalfN * n,
            stop: close - stopN * n,
          });
          continue;
        }

        // In a position: check exit first (stop or downside breakout), then a possible add.
        const lo = priorLow(bars, exitDonchian);
        if (close <= st.stop || (lo != null && close < lo)) {
          ctx.exit(code);
          state.set(code, { ...st, units: 0 });
          continue;
        }
        if (st.units < maxUnits && close >= st.addAbove) {
          ctx.order(code, st.unitShares);
          st.units += 1;
          st.addAbove = close + addHalfN * st.n;
          st.stop = close - stopN * st.n; // trail the stop up to 2N below the latest unit
        }
      }
    },
  };
}
