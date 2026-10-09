import { expect, it } from 'vitest';
import { CTX_PROP_NAMES, SDK_ENTRIES } from '@jixie/shared';
import type { CodeStrategy, StrategyCtx } from '@jixie/shared/sdk/strategy/contract';
import { StrategyContext, defineStrategy, applyStrategyParamOverrides } from './typescript.js';
import type { StrategyCapabilities } from './capabilities.js';

it('binds public Strategy helpers to capabilities without an Engine instance', async () => {
  const { capabilities, targets, setEquity } = capabilityFixture();
  const context = new StrategyContext(capabilities, { lookback: 3 });
  context.stock.equalWeight(['AAA', 'BBB']);
  setEquity(2_000);

  expect(targets).toEqual([{ AAA: 0.5, BBB: 0.5 }]);
  expect(context.stock.equity).toBe(2_000);
  expect(context.sma('AAA', 3)).toBe(12);
  expect(context.params.lookback).toBe(3);
  expect(Object.isFrozen(context.params)).toBe(true);
  expect((await context.universe()).codes()).toEqual([]);
  expect(context).not.toHaveProperty('loadCrossSection');
  expect(context).not.toHaveProperty('resampledBars');
});

it('keeps parameters immutable, capabilities private and public methods detached and enumerable', async () => {
  const { capabilities } = capabilityFixture();
  const parameters = { lookback: 3 };
  const context = new StrategyContext(capabilities, parameters);
  parameters.lookback = 99;

  const { sma, universe, period } = context;
  expect(sma('AAA', 3)).toBe(12);
  expect((await universe()).codes()).toEqual([]);
  expect(period('monthly')).toBe('202601');
  expect(context.params.lookback).toBe(3);
  expect(Reflect.set(context.params, 'lookback', 9)).toBe(false);
  expect(Reflect.set(context, 'params', {})).toBe(false);
  expect(context).not.toHaveProperty('capabilities');
  expect(Object.keys(context).sort()).toEqual(
    [
      ...CTX_PROP_NAMES,
      ...SDK_ENTRIES.filter((entry) => entry.iface === 'StrategyCtx').map((entry) => entry.name),
    ].sort(),
  );
});

it('normalizes the definition independently of context creation and preserves the author receiver', async () => {
  const { capabilities } = capabilityFixture();
  const received: StrategyCtx[] = [];
  const definition: CodeStrategy<{ lookback: number }> = {
    params: { lookback: 3 },
    onBar(context) {
      expect(this).toBe(definition);
      received.push(context);
    },
  };
  const strategy = defineStrategy(definition);

  expect(received).toEqual([]);
  expect(definition.name).toBeUndefined();
  applyStrategyParamOverrides(strategy, { lookback: 5 });
  const first = new StrategyContext(capabilities, strategy.params);
  await strategy.onBar(first);

  applyStrategyParamOverrides(strategy, { lookback: 8 });
  const second = new StrategyContext(capabilities, strategy.params);
  await strategy.onBar(second);

  expect(received).toEqual([first, second]);
  expect(first).not.toBe(second);
  expect(first.params.lookback).toBe(5);
  expect(second.params.lookback).toBe(8);
  expect(definition.params).toEqual({ lookback: 3 });
});

function capabilityFixture() {
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
  return {
    capabilities,
    targets,
    setEquity(value: number) {
      equity = value;
    },
  };
}
