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

/** What an IndExpr reads from: the instrument's bar window (ascending, last element = today). */
export interface IndScope {
  bars: OhlcBar[];
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
    case 'unary': {
      const v = evalIndExpr(e.arg, scope);
      return e.op === 'neg' ? -v : Math.abs(v);
    }
    case 'binary': {
      const l = evalIndExpr(e.left, scope);
      const r = evalIndExpr(e.right, scope);
      return e.op === '+' ? l + r : e.op === '-' ? l - r : e.op === '*' ? l * r : l / r;
    }
  }
}

/** Evaluate a boolean condition. A comparison with a missing (non-finite) side is false — a warming-up
 * indicator never triggers a trade. */
export function evalCondition(c: Condition, scope: IndScope): boolean {
  switch (c.kind) {
    case 'compare': {
      const l = evalIndExpr(c.left, scope);
      const r = evalIndExpr(c.right, scope);
      if (!Number.isFinite(l) || !Number.isFinite(r)) return false;
      return c.op === '>' ? l > r : c.op === '>=' ? l >= r : c.op === '<' ? l < r : l <= r;
    }
    case 'and':
      return c.args.every((a) => evalCondition(a, scope));
    case 'or':
      return c.args.some((a) => evalCondition(a, scope));
    case 'not':
      return !evalCondition(c.arg, scope);
  }
}

/** Largest indicator window referenced across the given conditions — how many bars to load. */
export function maxWindow(...conditions: Condition[]): number {
  let m = 1;
  const visitExpr = (e: IndExpr): void => {
    if (e.kind === 'indicator') m = Math.max(m, e.window);
    else if (e.kind === 'unary') visitExpr(e.arg);
    else if (e.kind === 'binary') {
      visitExpr(e.left);
      visitExpr(e.right);
    }
  };
  const visitCond = (c: Condition): void => {
    if (c.kind === 'compare') {
      visitExpr(c.left);
      visitExpr(c.right);
    } else if (c.kind === 'and' || c.kind === 'or') c.args.forEach(visitCond);
    else visitCond(c.arg);
  };
  conditions.forEach(visitCond);
  return m;
}
