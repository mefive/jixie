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
    ensureBars: async () => {},
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

describe('interpretPipeline', () => {
  // Same ep strategy expressed as a stage pipeline (universe → select → sizing, no timing).
  const epPipeline: StrategyIR = {
    schedule: 'monthly',
    stages: [
      { kind: 'universe', source: { type: 'all' } },
      {
        kind: 'select',
        score: { kind: 'binary', op: '/', left: { kind: 'const', value: 1 }, right: { kind: 'field', name: 'peTtm' } },
        side: 'high',
        pick: { by: 'quantile', value: 0.1 },
      },
      { kind: 'sizing', method: { kind: 'equal' } },
    ],
  };

  it('reproduces the cross-section result via stages (top decile, equal-weight)', async () => {
    const cap: { targets?: Record<string, number> } = {};
    await interpretStrategy(epPipeline).onBar(mockCtx('20240101', universe(30), cap));
    expect(Object.keys(cap.targets!).sort()).toEqual(['S0', 'S1', 'S2']);
    for (const w of Object.values(cap.targets!)) expect(w).toBeCloseTo(1 / 3);
  });

  it('topN pick + kSlots sizing', async () => {
    const ir: StrategyIR = {
      schedule: 'monthly',
      stages: [
        { kind: 'universe', source: { type: 'all' } },
        { kind: 'select', score: { kind: 'field', name: 'peTtm' }, side: 'low', pick: { by: 'topN', value: 5 } },
        { kind: 'sizing', method: { kind: 'kSlots', k: 4 } },
      ],
    };
    const cap: { targets?: Record<string, number> } = {};
    await interpretStrategy(ir).onBar(mockCtx('20240101', universe(30), cap));
    // lowest peTtm = S0..S4 (5 picked), kSlots(4) caps to 4 names at 1/4 each
    expect(Object.keys(cap.targets!).length).toBe(4);
    for (const w of Object.values(cap.targets!)) expect(w).toBeCloseTo(1 / 4);
  });
});
