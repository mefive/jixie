import { expect, it } from 'vitest';
import { enrich } from './typescript.js';
import type { StrategyCapabilities } from './capabilities.js';

it('binds public Strategy helpers to capabilities without an Engine instance', async () => {
  const targets: Array<Record<string, number> | Map<string, number>> = [];
  let equity = 1_000;
  const unsupported = () => {
    throw new Error('unused fixture capability');
  };
  const capabilities: StrategyCapabilities = {
    date: '20260105',
    portfolio: { equity: 1_000 },
    stock: {
      get equity() {
        return equity;
      },
      availableCash: 1_000,
      positions: () => [],
      adjustedShares: () => 0,
      setTargetWeights: (weights) => {
        targets.push(weights);
      },
      setTargetWeight: unsupported,
      orderAdjustedShares: unsupported,
      orderLots: unsupported,
      closePosition: unsupported,
      stopLossAtAdjustedPrice: unsupported,
      trailingStopByFraction: unsupported,
      limitBuyAtAdjustedPrice: unsupported,
      takeProfitByFraction: unsupported,
      cancelConditional: unsupported,
    },
    futures: {
      equity: 0,
      availableCash: 0,
      margin: 0,
      position: () => null,
      orderContracts: unsupported,
      setTargetContracts: unsupported,
      setTargetNotional: unsupported,
      hedgeStock: unsupported,
      closePosition: unsupported,
    },
    bar: () => null,
    bars: () => [],
    ensureBars: async () => {},
    listDays: () => null,
    industry: () => null,
    lhbNet: () => null,
    price: () => null,
    history: () => [10, 12, 14],
    factor: () => null,
    indexMembers: async () => [],
    index: unsupported,
    future: () => null,
    futureHistory: () => [],
    loadCrossSection: async () => [],
    resampledBars: () => [],
  };
  const context = enrich(capabilities, { lookback: 3 });
  context.stock.equalWeight(['AAA', 'BBB']);
  equity = 2_000;

  expect(targets).toEqual([{ AAA: 0.5, BBB: 0.5 }]);
  expect(context.stock.equity).toBe(2_000);
  expect(context.sma('AAA', 3)).toBe(12);
  expect(context.params.lookback).toBe(3);
  expect(Object.isFrozen(context.params)).toBe(true);
  expect((await context.universe()).codes()).toEqual([]);
  expect(context).not.toHaveProperty('loadCrossSection');
  expect(context).not.toHaveProperty('resampledBars');
});
