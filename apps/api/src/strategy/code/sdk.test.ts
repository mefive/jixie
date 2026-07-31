import { describe, expect, it } from 'vitest';
import { Universe, enrich, periodKey } from './sdk.js';
import type { BarContext, BarRow } from '../../engine/types.js';

// A bag of fake today-rows keyed by code, plus listDays, behind a minimal BarContext for Universe.
function ctxOf(
  rows: Record<string, Partial<BarRow>>,
  listDays: Record<string, number> = {},
  members: Record<string, string[]> = {},
) {
  const setHoldingsArg: { value: Record<string, number> | null } = { value: null };
  const ctx = {
    date: '20240131',
    bar: (c: string) => (rows[c] ? ({ code: c, ...rows[c] } as BarRow) : null),
    listDays: (c: string) => listDays[c] ?? null,
    // The index restriction is applied in the data layer (loadCrossSection), so the mock returns
    // members ∩ universe when given an index code — mirroring the real pushdown.
    loadCrossSection: async (idx?: string) => {
      const all = Object.keys(rows);
      if (!idx) {
        return all;
      }
      const set = new Set(members[idx] ?? []);
      return all.filter((c) => set.has(c));
    },
    indexMembers: async (idx: string) => members[idx] ?? [],
    setHoldings: (w: Record<string, number>) => (setHoldingsArg.value = w),
  } as unknown as BarContext;
  return { ctx, setHoldingsArg };
}

describe('Universe', () => {
  const rows = {
    A: { peTtm: 10, turnoverRate: 5 }, // ep 0.100
    B: { peTtm: 20, turnoverRate: 1 }, // ep 0.050, least liquid
    C: { peTtm: 5, turnoverRate: 9 }, // ep 0.200 (cheapest)
    D: { peTtm: -3, turnoverRate: 7 }, // ep invalid (negative PE)
  };

  it('where + rankBy(desc) + top(fraction) picks the cheapest decile', () => {
    const { ctx } = ctxOf(rows);
    const picks = new Universe(ctx, Object.keys(rows))
      .where((b) => b.peTtm != null && b.peTtm > 0) // drops D
      .rankBy((b) => 1 / b.peTtm!, 'desc') // C(0.2) > A(0.1) > B(0.05)
      .top(0.5); // 3 valid → floor(1.5)=1 → top 1
    expect(picks).toEqual(['C']);
  });

  it('rankBy drops codes scoring null/non-finite', () => {
    const { ctx } = ctxOf(rows);
    const ranked = new Universe(ctx, Object.keys(rows)).rankBy((b) =>
      b.peTtm && b.peTtm > 0 ? 1 / b.peTtm : null,
    );
    expect(ranked.codes()).toEqual(['C', 'A', 'B']); // D dropped, sorted desc by ep
  });

  it('dropBottom removes the least-liquid fraction', () => {
    const { ctx } = ctxOf(rows);
    // 4 codes, drop bottom 25% by turnover → floor(4*0.25)=1 → drop B (turnover 1)
    const kept = new Universe(ctx, Object.keys(rows)).dropBottom(0.25, (b) => b.turnoverRate ?? 0);
    expect(kept.codes()).not.toContain('B');
    expect(kept.length).toBe(3);
  });

  it('minListDays keeps unknown-age and old-enough names, drops the too-new', () => {
    const { ctx } = ctxOf(rows, { A: 1000, B: 100 }); // C/D unknown
    const kept = new Universe(ctx, Object.keys(rows)).minListDays(365);
    expect(kept.codes().sort()).toEqual(['A', 'C', 'D']); // B (100d) dropped
  });

  it('top(N>=1) takes an explicit count', () => {
    const { ctx } = ctxOf(rows);
    expect(new Universe(ctx, ['A', 'B', 'C']).top(2)).toEqual(['A', 'B']);
  });
});

describe('enrich', () => {
  it('equalWeight sets equal target weights via setHoldings', () => {
    const { ctx, setHoldingsArg } = ctxOf({ A: {}, B: {} });
    enrich(ctx).equalWeight(['A', 'B', 'C']);
    expect(setHoldingsArg.value).toEqual({ A: 1 / 3, B: 1 / 3, C: 1 / 3 });
  });

  it('provides neutral ATR-risk units and inverse-volatility weights', () => {
    const { ctx } = ctxOf({});
    Object.defineProperty(ctx, 'value', { value: 100_000 });
    ctx.bars = () => [
      {
        date: '1',
        adjOpen: 9,
        adjHigh: 11,
        adjLow: 9,
        adjClose: 10,
        vol: 1,
        amount: 1,
        turnoverRateF: null,
      },
      {
        date: '2',
        adjOpen: 10,
        adjHigh: 13,
        adjLow: 10,
        adjClose: 12,
        vol: 1,
        amount: 1,
        turnoverRateF: null,
      },
      {
        date: '3',
        adjOpen: 12,
        adjHigh: 14,
        adjLow: 11,
        adjClose: 13,
        vol: 1,
        amount: 1,
        turnoverRateF: null,
      },
    ];
    ctx.history = (code) => (code === 'A' ? [100, 110, 100] : code === 'B' ? [100, 102, 104] : []);

    const sdk = enrich(ctx);
    expect(sdk.atrUnits('A', 0.01, 2)).toBe(333);
    const weights = sdk.volTargetWeights(['A', 'B', 'MISSING'], 2);
    expect([...weights.keys()]).toEqual(['A', 'B']);
    expect((weights.get('B') ?? 0) > (weights.get('A') ?? 0)).toBe(true);
    expect([...weights.values()].reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });

  it('universe() loads the cross-section into a Universe', async () => {
    const { ctx } = ctxOf({ A: { peTtm: 10 }, B: { peTtm: 20 } });
    const u = await enrich(ctx).universe();
    expect(u.codes().sort()).toEqual(['A', 'B']);
  });

  it('universe(indexCode) restricts to that index’s point-in-time members ∩ universe', async () => {
    const { ctx } = ctxOf(
      { A: {}, B: {}, C: {} },
      {},
      { '000300.SH': ['A', 'C', 'Z'] }, // Z not tradable today → not in the loaded panel → dropped
    );
    const u = await enrich(ctx).universe('000300.SH');
    expect(u.codes().sort()).toEqual(['A', 'C']);
  });

  it('period() reflects the schedule bucket', () => {
    const { ctx } = ctxOf({});
    expect(enrich(ctx).period('monthly')).toBe('202401');
    expect(enrich(ctx).period('daily')).toBe('20240131');
  });

  it('weekly()/monthly() expose completed-period bars through the shared indicator surface', () => {
    const { ctx } = ctxOf({});
    const weeklyBars = [
      {
        date: '20240105',
        adjOpen: 9,
        adjHigh: 12,
        adjLow: 8,
        adjClose: 10,
        vol: 100,
        amount: 1000,
        turnoverRateF: null,
      },
      {
        date: '20240112',
        adjOpen: 10,
        adjHigh: 14,
        adjLow: 9,
        adjClose: 12,
        vol: 200,
        amount: 3000,
        turnoverRateF: null,
      },
    ];
    ctx.resampledBars = (_code, period, n) => (period === 'weekly' ? weeklyBars.slice(-n) : []);

    const weekly = enrich(ctx).weekly('A');
    expect(weekly.bars(1)).toEqual([weeklyBars[1]]);
    expect(weekly.history('close', 2)).toEqual([10, 12]);
    expect(weekly.sma(2)).toBe(11);
    expect(weekly.highest('high', 2)).toBe(14);
    expect(weekly.avgAmount(2)).toBe(2000);
    expect(enrich(ctx).monthly('A').bars(2)).toEqual([]);
  });
});

describe('periodKey', () => {
  it('monthly = YYYYMM, daily = full date, weekly = ISO Monday key', () => {
    expect(periodKey('20240131', 'monthly')).toBe('202401');
    expect(periodKey('20240131', 'daily')).toBe('20240131');
    expect(periodKey('20240101', 'weekly')).toBe('20240101');
    expect(periodKey('20240103', 'weekly')).toBe('20240101');
    expect(periodKey('20231231', 'weekly')).toBe('20231225');
  });
});
