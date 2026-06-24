import { describe, expect, it } from 'vitest';
import type { StrategyIR } from '@jixie/shared';
import { interpretStrategy } from './interpret.js';
import type { BarContext, BarRow } from '../../engine/types.js';

/** A bar with only the fields the cross-section interpreter reads (peTtm + turnover). */
function bar(code: string, peTtm: number, turnover = 1): BarRow {
  return {
    code,
    open: null, high: null, low: null, close: null,
    adjOpen: null, adjHigh: null, adjLow: null, adjClose: 1,
    pe: null, peTtm, pb: null, ps: null, psTtm: null,
    dvRatio: null, dvTtm: null, totalMv: null, circMv: null, turnoverRate: turnover,
  };
}

/** Minimal BarContext over a fixed cross-section; captures the last setHoldings target book. */
function mockCtx(
  date: string,
  bars: Map<string, BarRow>,
  cap: { targets?: Record<string, number> },
): BarContext {
  return {
    date,
    cash: 0,
    value: 0,
    positions: () => [],
    universe: async () => [...bars.keys()],
    bar: (c) => bars.get(c) ?? null,
    bars: () => [],
    listDays: () => 1000,
    price: () => null,
    history: () => [],
    factor: () => null,
    shares: () => 0,
    orderTargetPercent: () => {},
    setHoldings: (w) => {
      cap.targets = w instanceof Map ? Object.fromEntries(w) : { ...w };
    },
    order: () => {},
    exit: () => {},
  };
}

const universe = (n: number) => {
  const m = new Map<string, BarRow>();
  for (let i = 0; i < n; i++) m.set(`S${i}`, bar(`S${i}`, 10 + i)); // pe 10..10+n-1
  return m;
};

describe('interpretCrossSection', () => {
  const ep: StrategyIR = {
    type: 'cross_section',
    schedule: 'monthly',
    universe: { filters: [] },
    score: { kind: 'binary', op: '/', left: { kind: 'const', value: 1 }, right: { kind: 'field', name: 'peTtm' } },
    pick: { side: 'high', quantile: 0.1 },
    weight: 'equal',
  };

  it('picks the top-quantile by score and equal-weights', async () => {
    const cap: { targets?: Record<string, number> } = {};
    await interpretStrategy(ep).onBar(mockCtx('20240101', universe(30), cap));
    // ep = 1/pe → highest ep = lowest pe; decile of 30 = top 3 = S0,S1,S2
    expect(Object.keys(cap.targets!).sort()).toEqual(['S0', 'S1', 'S2']);
    for (const w of Object.values(cap.targets!)) expect(w).toBeCloseTo(1 / 3);
  });

  it('rebalances once per month (no-op on same-month bars)', async () => {
    const strat = interpretStrategy(ep);
    const c1: { targets?: Record<string, number> } = {};
    const c2: { targets?: Record<string, number> } = {};
    await strat.onBar(mockCtx('20240101', universe(30), c1));
    await strat.onBar(mockCtx('20240115', universe(30), c2)); // same month → skip
    expect(c1.targets).toBeDefined();
    expect(c2.targets).toBeUndefined();
  });

  it('skips when fewer than 20 candidates', async () => {
    const cap: { targets?: Record<string, number> } = {};
    await interpretStrategy(ep).onBar(mockCtx('20240101', universe(10), cap));
    expect(cap.targets).toBeUndefined();
  });
});
