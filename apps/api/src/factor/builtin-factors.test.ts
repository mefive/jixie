import { describe, expect, it } from 'vitest';
import type { FactorBar } from '@jixie/shared';
import { BUILTIN_FACTORS } from './builtin-factors.js';
import { compileFactor, type CompiledFactor, type FactorBatchItem } from './compile-factor.js';
import { daysBetween } from '../lib/date.js';

/**
 * Step 1b acceptance: every preset compiles, and the seeded CODE reproduces the legacy hardcoded
 * formulas bit-for-bit (so migrating presets onto the compile+compute path can't silently change
 * any cached-report semantics). The legacy formulas are copied here verbatim as the reference.
 */

// —— legacy reference implementations (the deleted factor/factors.ts, verbatim) ——

const MAX_GAP_DAYS = 30;

function maxGapDays(dates: string[], from: number, to: number): number {
  let m = 0;
  for (let i = from + 1; i <= to; i++) {
    const g = daysBetween(dates[i - 1], dates[i]);
    if (g > m) {
      m = g;
    }
  }
  return m;
}

function legacyMomentum(px: number[], dates: string[], end: number, lookback = 60, skip = 5) {
  if (end - lookback < 0 || maxGapDays(dates, end - lookback, end) > MAX_GAP_DAYS) {
    return null;
  }
  const a = px[end - skip];
  const b = px[end - lookback];
  if (!a || !b) {
    return null;
  }
  return a / b - 1;
}

function legacyReversal(px: number[], dates: string[], end: number, window = 5) {
  if (end - window < 0 || maxGapDays(dates, end - window, end) > MAX_GAP_DAYS) {
    return null;
  }
  const a = px[end];
  const b = px[end - window];
  if (!b) {
    return null;
  }
  return a / b - 1;
}

function legacyVolatility(px: number[], dates: string[], end: number, window = 20) {
  if (end - window < 0 || maxGapDays(dates, end - window, end) > MAX_GAP_DAYS) {
    return null;
  }
  const rets: number[] = [];
  for (let i = end - window + 1; i <= end; i++) {
    const prev = px[i - 1];
    if (!prev) {
      return null;
    }
    rets.push(px[i] / prev - 1);
  }
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance);
}

// —— fixtures ——

const NULL_BAR: FactorBar = {
  code: '000001.SZ',
  pe: null,
  peTtm: null,
  pb: null,
  ps: null,
  psTtm: null,
  dvRatio: null,
  dvTtm: null,
  totalMv: null,
  circMv: null,
  turnoverRate: null,
  netMain: null,
  netTotal: null,
  roe: null,
  grossprofitMargin: null,
  debtToAssets: null,
};

/** Mirrors analysis.ts: batch items carry the window (of `window` length) ENDING at index `end`. */
function windowItem(
  window: number,
  adjClose: number[],
  tradeDates: string[],
  end: number,
): FactorBatchItem {
  const from = Math.max(0, end - window + 1);
  return {
    bar: NULL_BAR,
    closes: adjClose.slice(from, end + 1),
    dates: tradeDates.slice(from, end + 1),
  };
}

/** A deterministic 120-day series: pseudo-random walk, one long suspension gap, one zero price. */
function syntheticSeries(): { px: number[]; dates: string[] } {
  const px: number[] = [];
  const dates: string[] = [];
  let price = 10;
  let day = Date.UTC(2023, 0, 3);
  let seed = 42;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  for (let i = 0; i < 120; i++) {
    price = price * (1 + (random() - 0.5) * 0.06);
    // A 45-calendar-day suspension between bars 69 and 70; weekends skipped crudely elsewhere.
    day += (i === 70 ? 45 : 1 + Math.floor(random() * 3)) * 86400000;
    const d = new Date(day);
    const pad = (x: number) => String(x).padStart(2, '0');
    px.push(i === 30 ? 0 : price); // bar 30 has a zero price (legacy `!prev` guard)
    dates.push(`${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`);
  }
  return { px, dates };
}

async function compiled(key: string): Promise<CompiledFactor> {
  const def = BUILTIN_FACTORS.find((factor) => factor.key === key)!;
  return compileFactor(def.code);
}

/** One-item batch helper for the cross-sectional (no-window) presets. */
async function computeOne(key: string, bar: FactorBar): Promise<number | null> {
  const factor = await compiled(key);
  try {
    return (await factor.computeBatch([{ bar }]))[0];
  } finally {
    factor.dispose();
  }
}

// —— tests ——

describe('preset factor code compiles and has the right shape', () => {
  it.each(BUILTIN_FACTORS.map((factor) => [factor.key, factor] as const))(
    '%s compiles',
    async (_key, def) => {
      const factor = await compileFactor(def.code);
      expect(factor.name).toBe(def.label);
      expect(typeof factor.computeBatch).toBe('function');
      factor.dispose();
    },
  );

  it('price factors declare window, cross-sectional ones do not', async () => {
    expect((await compiled('mom')).window).toBe(61);
    expect((await compiled('rev')).window).toBe(6);
    expect((await compiled('vol')).window).toBe(21);
    expect((await compiled('ep')).window).toBeUndefined();
    expect((await compiled('mf_net_main')).window).toBeUndefined();
  });
});

describe('price presets match the legacy hardcoded formulas bit-for-bit', () => {
  const { px, dates } = syntheticSeries();
  const cases: [string, (px: number[], dates: string[], end: number) => number | null][] = [
    ['mom', (p, d, e) => legacyMomentum(p, d, e)],
    ['rev', (p, d, e) => legacyReversal(p, d, e)],
    ['vol', (p, d, e) => legacyVolatility(p, d, e)],
  ];

  it.each(cases)(
    '%s matches on all 120 cutoffs (one batched wall-crossing)',
    async (key, legacy) => {
      const factor = await compiled(key);
      const items = px.map((_price, end) => windowItem(factor.window!, px, dates, end));
      const actualValues = await factor.computeBatch(items);
      factor.dispose();
      for (let end = 0; end < px.length; end++) {
        const expected = legacy(px, dates, end);
        if (expected == null) {
          expect(actualValues[end], `end=${end}`).toBeNull();
        } else {
          expect(actualValues[end], `end=${end}`).toBeCloseTo(expected, 12);
        }
      }
    },
  );
});

describe('cross-sectional presets match the legacy hardcoded formulas', () => {
  const bars: Partial<FactorBar>[] = [
    { peTtm: 12.5, pb: 1.6, dvRatio: 4.2, totalMv: 1_000_000, netMain: 1234.5, netTotal: -88 },
    { peTtm: -8, pb: 0, dvRatio: null, totalMv: 0, netMain: null, netTotal: null },
    { peTtm: null, pb: 7.7, dvRatio: 0, totalMv: 88_888, netMain: 0, netTotal: 5 },
  ];
  const make = (partial: Partial<FactorBar>): FactorBar => ({ ...NULL_BAR, ...partial });

  it('ep / bp / dv / size', async () => {
    for (const partial of bars) {
      const bar = make(partial);
      const legacyEp = bar.peTtm && bar.peTtm > 0 ? 1 / bar.peTtm : null;
      const legacyBp = bar.pb && bar.pb > 0 ? 1 / bar.pb : null;
      const legacySize = bar.totalMv && bar.totalMv > 0 ? Math.log(bar.totalMv) : null;
      expect(await computeOne('ep', bar)).toBe(legacyEp);
      expect(await computeOne('bp', bar)).toBe(legacyBp);
      expect(await computeOne('dv', bar)).toBe(bar.dvRatio);
      expect(await computeOne('size', bar)).toBe(legacySize);
    }
  });

  it('mf_net_main / mf_net_total read the bar moneyflow fields directly', async () => {
    const bar = make({ netMain: 666, netTotal: -42 });
    expect(await computeOne('mf_net_main', bar)).toBe(666);
    expect(await computeOne('mf_net_total', bar)).toBe(-42);
  });
});
