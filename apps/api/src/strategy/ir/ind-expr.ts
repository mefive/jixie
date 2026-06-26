import type { Condition, IndExpr, IndicatorName, PriceField } from '@jixie/shared';
import type { OhlcBar } from '../../engine/types.js';

/**
 * Evaluator for the per_instrument IR — indicators + boolean conditions over ONE instrument's bar
 * window. Pure (no eval, safe for untrusted IR); the engine feeds it the window via `ctx.bars`.
 *
 * Indicator conventions: `highest`/`lowest` scan the n bars BEFORE today (Donchian channel, so a
 * breakout reads as `price > highest(high, 20)`); `sma`/`ema`/`atr` use the last n bars. Adjusted
 * (hfq) OHLC throughout, matching the rest of the engine.
 */

/** What an IndExpr reads from: the instrument's bar window (ascending, last = today) plus, for the
 * timing state machine, its per-instrument state / position / equity. The latter are optional so plain
 * indicator evaluation (and tests) can pass just `{ bars }`. */
export interface IndScope {
  bars: OhlcBar[];
  state?: (name: string) => number;
  shares?: number;
  equity?: number;
}

const fieldOf = (b: OhlcBar, f: PriceField): number =>
  f === 'open' ? b.adjOpen : f === 'high' ? b.adjHigh : f === 'low' ? b.adjLow : b.adjClose;

function indicator(name: IndicatorName, field: PriceField, n: number, bars: OhlcBar[]): number {
  const len = bars.length;
  switch (name) {
    case 'highest': {
      if (len < n + 1) return NaN;
      let h = -Infinity;
      for (let i = len - 1 - n; i < len - 1; i++) h = Math.max(h, fieldOf(bars[i], field));
      return h;
    }
    case 'lowest': {
      if (len < n + 1) return NaN;
      let l = Infinity;
      for (let i = len - 1 - n; i < len - 1; i++) l = Math.min(l, fieldOf(bars[i], field));
      return l;
    }
    case 'sma': {
      if (len < n) return NaN;
      let s = 0;
      for (let i = len - n; i < len; i++) s += fieldOf(bars[i], field);
      return s / n;
    }
    case 'ema': {
      if (len < n) return NaN;
      const k = 2 / (n + 1);
      let ema = fieldOf(bars[len - n], field);
      for (let i = len - n + 1; i < len; i++) ema = fieldOf(bars[i], field) * k + ema * (1 - k);
      return ema;
    }
    case 'atr': {
      if (len < n + 1) return NaN;
      let s = 0;
      for (let i = len - n; i < len; i++) {
        const pc = bars[i - 1].adjClose;
        s += Math.max(
          bars[i].adjHigh - bars[i].adjLow,
          Math.abs(bars[i].adjHigh - pc),
          Math.abs(bars[i].adjLow - pc),
        );
      }
      return s / n;
    }
  }
}

export function evalIndExpr(e: IndExpr, scope: IndScope): number {
  switch (e.kind) {
    case 'const':
      return e.value;
    case 'price':
      return scope.bars.length ? scope.bars[scope.bars.length - 1].adjClose : NaN;
    case 'indicator':
      return indicator(e.name, e.field ?? 'close', e.window, scope.bars);
    case 'state':
      return scope.state?.(e.name) ?? 0;
    case 'shares':
      return scope.shares ?? 0;
    case 'equity':
      return scope.equity ?? 0;
    case 'unary': {
      const v = evalIndExpr(e.arg, scope);
      return e.op === 'neg' ? -v : e.op === 'abs' ? Math.abs(v) : Math.floor(v);
    }
    case 'binary': {
      const l = evalIndExpr(e.left, scope);
      const r = evalIndExpr(e.right, scope);
      switch (e.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          return l / r;
        case 'min':
          return Math.min(l, r);
        case 'max':
          return Math.max(l, r);
      }
    }
  }
}

/** Evaluate a boolean condition. A comparison with a missing (non-finite) side is false — a warming-up
 * indicator never triggers a trade. == / != use a small epsilon (float-safe). */
export function evalCondition(c: Condition, scope: IndScope): boolean {
  switch (c.kind) {
    case 'compare': {
      const l = evalIndExpr(c.left, scope);
      const r = evalIndExpr(c.right, scope);
      if (!Number.isFinite(l) || !Number.isFinite(r)) return false;
      switch (c.op) {
        case '>':
          return l > r;
        case '>=':
          return l >= r;
        case '<':
          return l < r;
        case '<=':
          return l <= r;
        case '==':
          return Math.abs(l - r) < 1e-9;
        case '!=':
          return Math.abs(l - r) >= 1e-9;
      }
    }
    // eslint-disable-next-line no-fallthrough
    case 'and':
      return c.args.every((a) => evalCondition(a, scope));
    case 'or':
      return c.args.some((a) => evalCondition(a, scope));
    case 'not':
      return !evalCondition(c.arg, scope);
  }
}

/** Largest indicator window referenced in an IndExpr (0 if none). */
export function indExprWindow(e: IndExpr): number {
  if (e.kind === 'indicator') return e.window;
  if (e.kind === 'unary') return indExprWindow(e.arg);
  if (e.kind === 'binary') return Math.max(indExprWindow(e.left), indExprWindow(e.right));
  return 0;
}

/** Largest indicator window referenced across the given conditions — how many bars to load. */
export function maxWindow(...conditions: Condition[]): number {
  let m = 1;
  const visitCond = (c: Condition): void => {
    if (c.kind === 'compare') m = Math.max(m, indExprWindow(c.left), indExprWindow(c.right));
    else if (c.kind === 'and' || c.kind === 'or') c.args.forEach(visitCond);
    else visitCond(c.arg);
  };
  conditions.forEach(visitCond);
  return m;
}
