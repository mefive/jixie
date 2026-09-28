import { describe, expect, it } from 'vitest';
import type { StrategyFinalState } from '#engine/types.js';
import { projectSignals } from './projection.js';

function state(overrides: Partial<StrategyFinalState> = {}): StrategyFinalState {
  return {
    tradeDate: '20240103',
    equity: 10_000,
    cash: 8_000,
    positions: new Map([
      ['A', { shares: 100, avgCost: 20, frozenUntil: '20240104', frozenShares: 25 }],
    ]),
    pendingTargets: null,
    pendingOrders: null,
    pendingLotOrders: null,
    conditionalOrders: new Map(),
    market: new Map([
      ['A', { assetType: 'stock', adjustedClose: 20, adjustmentFactor: 2, rawClose: 10 }],
      ['B', { assetType: 'etf', adjustedClose: 40, adjustmentFactor: 2, rawClose: 20 }],
    ]),
    factorObservations: [{ key: 'trend', code: 'A', value: 1 }],
    ...overrides,
  };
}

describe('final-state signal projection', () => {
  it('converts adjusted targets and frozen positions to real shares without mutating the snapshot', () => {
    const snapshot = state({ pendingTargets: new Map([['B', 0.4]]) });
    const before = structuredClone(snapshot);
    const output = projectSignals(snapshot);
    expect(output.signals).toEqual([
      {
        code: 'A',
        assetType: 'stock',
        action: 'sell',
        shares: 200,
        refPrice: 10,
        refAmount: 2000,
        source: 'target',
        targetWeight: 0,
      },
      {
        code: 'B',
        assetType: 'etf',
        action: 'buy',
        shares: 200,
        refPrice: 20,
        refAmount: 4000,
        source: 'target',
        targetWeight: 0.4,
      },
    ]);
    expect(output.modelPositions).toEqual([
      {
        code: 'A',
        assetType: 'stock',
        shares: 200,
        markPrice: 10,
        sellableFrom: '20240104',
        frozenShares: 50,
      },
    ]);
    expect(output.modelCash).toBe(8000);
    expect(output.modelEquity).toBe(10000);
    output.factorObservations[0].value = 999;
    expect(snapshot).toEqual(before);
  });

  it('caps delta sells at held shares and sizes lot orders in real shares', () => {
    const output = projectSignals(
      state({
        pendingOrders: new Map([
          ['A', -500],
          ['B', 49],
        ]),
        pendingLotOrders: new Map([['B', 1]]),
      }),
    );
    expect(output.signals).toEqual([
      expect.objectContaining({ code: 'A', action: 'sell', shares: 200, source: 'order' }),
      expect.objectContaining({ code: 'B', action: 'buy', shares: 100, source: 'order' }),
    ]);
  });

  it('projects a stop against a pending lot buy and adjusts a trailing trigger', () => {
    const output = projectSignals(
      state({
        positions: new Map(),
        pendingLotOrders: new Map([['A', 1]]),
        conditionalOrders: new Map([
          ['stop', { kind: 'stop_loss', code: 'A', triggerPrice: 18.4, placedDate: '20240103' }],
          [
            'trail',
            {
              kind: 'trailing_stop',
              code: 'A',
              highWater: 20,
              trailingPct: 0.08,
              placedDate: '20240103',
            },
          ],
        ]),
      }),
    );
    expect(output.signals).toHaveLength(3);
    for (const signal of output.signals.slice(1)) {
      expect(signal).toMatchObject({ action: 'sell', shares: 100, source: 'conditional' });
      expect(signal.source).toBe('conditional');
      if (signal.source === 'conditional') {
        expect(signal.triggerPrice).toBeCloseTo(9.2);
        expect(signal.refAmount).toBeCloseTo(920);
      }
    }
  });

  it('sizes limit buys and exits from pending targets and deltas', () => {
    const output = projectSignals(
      state({
        pendingTargets: new Map([['A', 0.4]]),
        pendingOrders: new Map([['A', -50]]),
        conditionalOrders: new Map([
          [
            'limit',
            { kind: 'limit_buy', code: 'B', triggerPrice: 38, shares: 75, placedDate: '20240103' },
          ],
          ['exit', { kind: 'take_profit', code: 'A', triggerPrice: 24, placedDate: '20240103' }],
        ]),
      }),
    );
    expect(output.signals.filter((signal) => signal.source === 'conditional')).toEqual([
      expect.objectContaining({
        code: 'B',
        action: 'buy',
        shares: 100,
        triggerPrice: 19,
        refAmount: 1900,
      }),
      expect.objectContaining({
        code: 'A',
        action: 'sell',
        shares: 300,
        triggerPrice: 12,
        refAmount: 3600,
      }),
    ]);
  });

  it('preserves missing-price omission and clears expired T+1 freezes', () => {
    const snapshot = state({ pendingTargets: new Map([['B', 0.4]]) });
    snapshot.market.delete('B');
    snapshot.positions.get('A')!.frozenUntil = snapshot.tradeDate;
    const output = projectSignals(snapshot);
    expect(output.signals.map((signal) => signal.code)).toEqual(['A']);
    expect(output.modelPositions[0].frozenShares).toBe(0);
  });
});
