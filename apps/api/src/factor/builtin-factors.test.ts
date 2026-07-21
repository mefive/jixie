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

function windowItemWithTurnover(
  window: number,
  adjClose: number[],
  tradeDates: string[],
  turnoverRatesF: (number | null)[],
  end: number,
): FactorBatchItem {
  return {
    ...windowItem(window, adjClose, tradeDates, end),
    turnoverRatesF: turnoverRatesF.slice(Math.max(0, end - window + 1), end + 1),
  };
}

function windowItemWithAmounts(
  window: number,
  adjClose: number[],
  tradeDates: string[],
  amounts: (number | null)[],
  end: number,
): FactorBatchItem {
  return {
    ...windowItem(window, adjClose, tradeDates, end),
    amounts: amounts.slice(Math.max(0, end - window + 1), end + 1),
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

  it('accepts an explicit window coverage declaration', async () => {
    const factor = await compileFactor(`
      export default defineFactor({
        name: 'Coverage fixture',
        window: 20,
        minCoverage: 0.8,
        compute: (_bar, ctx) => ctx.history.close.at(-1) ?? null,
      });
    `);
    try {
      expect(factor.minCoverage).toBe(0.8);
    } finally {
      factor.dispose();
    }
  });

  it('exposes aligned daily turnover amount history to windowed factors', async () => {
    const factor = await compileFactor(`
      export default defineFactor({
        name: 'Amount fixture',
        window: 3,
        compute: (_bar, ctx) => {
          const amounts = ctx.history(3, 'amount');
          return amounts.some((value) => value == null)
            ? null
            : amounts.reduce((sum, value) => sum + value, 0);
        },
      });
    `);
    try {
      await expect(
        factor.computeBatch([
          {
            bar: NULL_BAR,
            closes: [10, 11, 12],
            dates: ['20240102', '20240103', '20240104'],
            amounts: [100, 200, 300],
          },
        ]),
      ).resolves.toEqual([600]);
    } finally {
      factor.dispose();
    }
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

  it('roe / gross_margin read the as-of fundamentals directly (null when unpublished)', async () => {
    const bar = make({ roe: 13.6, grossprofitMargin: 45.2 });
    expect(await computeOne('roe', bar)).toBe(13.6);
    expect(await computeOne('gross_margin', bar)).toBe(45.2);
    expect(await computeOne('roe', NULL_BAR)).toBeNull();
    expect(await computeOne('gross_margin', NULL_BAR)).toBeNull();
  });
});

describe('3.5 preset-menu additions', () => {
  // A clean 260-bar series: positive random walk, consecutive-ish dates, NO suspension gaps —
  // long enough for the 245-day window.
  function cleanLongSeries(): { px: number[]; dates: string[] } {
    const px: number[] = [];
    const dates: string[] = [];
    let price = 20;
    let day = Date.UTC(2022, 0, 4);
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let i = 0; i < 260; i++) {
      price = price * (1 + (random() - 0.5) * 0.04);
      day += (1 + Math.floor(random() * 3)) * 86400000;
      const d = new Date(day);
      const pad = (x: number) => String(x).padStart(2, '0');
      px.push(price);
      dates.push(`${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`);
    }
    return { px, dates };
  }

  it('declares the right windows; quality presets are cross-sectional', async () => {
    expect((await compiled('mom_12_1')).window).toBe(245);
    expect((await compiled('vol120')).window).toBe(121);
    expect((await compiled('abturn')).window).toBe(252);
    expect((await compiled('amihud')).window).toBe(21);
    expect((await compiled('amihud')).minCoverage).toBe(0.8);
    expect((await compiled('roe')).window).toBeUndefined();
    expect((await compiled('gross_margin')).window).toBeUndefined();
  });

  it('mom_12_1 = close[end-21] / close[end-244] − 1, null on short history', async () => {
    const { px, dates } = cleanLongSeries();
    const factor = await compiled('mom_12_1');
    const items = [
      windowItem(245, px, dates, 259), // full window
      windowItem(245, px, dates, 100), // insufficient history
    ];
    const [full, short] = await factor.computeBatch(items);
    factor.dispose();
    // Window [15..259]: index 0 = bar 15 (12 months back), index 223 = bar 238 (~1 month back).
    expect(full).toBeCloseTo(px[238] / px[15] - 1, 12);
    expect(short).toBeNull();
  });

  it('vol120 = population std of the last 120 daily returns', async () => {
    const { px, dates } = cleanLongSeries();
    const factor = await compiled('vol120');
    const [actual] = await factor.computeBatch([windowItem(121, px, dates, 259)]);
    factor.dispose();
    const returns: number[] = [];
    for (let i = 139; i < 259; i++) {
      returns.push(px[i + 1] / px[i] - 1);
    }
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
    expect(actual).toBeCloseTo(Math.sqrt(variance), 12);
  });

  it('abturn = latest 21-day mean / 252-day mean of free-float turnover', async () => {
    const { px, dates } = cleanLongSeries();
    const turnoverRates = dates.map((_date, index) => 1 + index / 100);
    const factor = await compiled('abturn');
    const [actual, short] = await factor.computeBatch([
      windowItemWithTurnover(252, px, dates, turnoverRates, 259),
      windowItemWithTurnover(252, px, dates, turnoverRates, 100),
    ]);
    factor.dispose();
    const window = turnoverRates.slice(8, 260);
    const longMean = window.reduce((sum, value) => sum + value, 0) / 252;
    const shortMean = window.slice(-21).reduce((sum, value) => sum + value, 0) / 21;
    expect(actual).toBeCloseTo(shortMean / longMean, 12);
    expect(short).toBeNull();
  });

  it('amihud = mean absolute return / turnover amount, with strict amount and gap checks', async () => {
    const closes = Array.from({ length: 21 }, (_value, index) => 10 * 1.01 ** index);
    const dates = Array.from(
      { length: 21 },
      (_value, index) => `202401${String(index + 2).padStart(2, '0')}`,
    );
    const amounts = Array.from({ length: 21 }, (_value, index) => 1_000 + index * 10);
    const factor = await compiled('amihud');
    const invalidAmounts: (number | null)[] = [...amounts];
    invalidAmounts[10] = null;
    const gapDates = [...dates];
    gapDates[10] = '20240220';
    const [actual, missingAmount, gap, short] = await factor.computeBatch([
      windowItemWithAmounts(21, closes, dates, amounts, 20),
      windowItemWithAmounts(21, closes, dates, invalidAmounts, 20),
      windowItemWithAmounts(21, closes, gapDates, amounts, 20),
      windowItemWithAmounts(21, closes, dates, amounts, 10),
    ]);
    factor.dispose();
    const expected =
      (amounts.slice(1).reduce((sum, amount) => sum + 0.01 / amount, 0) / 20) * 1_000_000;
    expect(actual).toBeCloseTo(expected, 12);
    expect(missingAmount).toBeNull();
    expect(gap).toBeNull();
    expect(short).toBeNull();
  });
});
