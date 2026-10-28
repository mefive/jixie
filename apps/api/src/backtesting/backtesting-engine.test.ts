import { describe, expect, it, vi } from 'vitest';
import { fixturePort } from './testing/fixture-port.js';
import { BacktestingEngine } from './backtesting-engine.js';
import type { BacktestingConfig } from './contract.js';

function config(): BacktestingConfig {
  return {
    start: '20240102',
    end: '20240103',
    initialCash: 10000,
    dataPort: fixturePort({
      stockPriceLimits: { up: 1000000, down: 0.0001 },
      dates: ['20240102', '20240103'],
      stocks: [],
    }),
    strategy: { name: 'lifecycle', onBar: vi.fn() },
  };
}

describe('BacktestingEngine lifecycle', () => {
  it('rejects concurrent and repeated execution without repeating decisions', async () => {
    const input = config();
    const simulation = new BacktestingEngine(input);
    const running = simulation.run();
    await expect(simulation.run()).rejects.toThrow('BacktestingEngine requires a fresh instance');
    const output = await running;
    await expect(simulation.run()).rejects.toThrow('BacktestingEngine requires a fresh instance');
    expect(input.strategy.onBar).toHaveBeenCalledTimes(2);
    expect(output.nav).toEqual([
      { date: '20240102', value: 10000 },
      { date: '20240103', value: 10000 },
    ]);
  });

  it('does not reuse partial state after a failed decision', async () => {
    const input = config();
    const onBar = vi.fn(() => {
      throw new Error('decision failed');
    });
    input.strategy.onBar = onBar;
    const simulation = new BacktestingEngine(input);
    await expect(simulation.run()).rejects.toThrow('decision failed');
    await expect(simulation.run()).rejects.toThrow('BacktestingEngine requires a fresh instance');
    expect(onBar).toHaveBeenCalledTimes(1);
  });
});

describe('cash-account attribution without factors', () => {
  it('attributes stock trades without factor metadata and marks their class as other', async () => {
    const input = config();
    input.dataPort = fixturePort({
      stockPriceLimits: { up: 1000000, down: 0.0001 },
      dates: ['20240102', '20240103'],
      stocks: [
        {
          code: 'A',
          bars: [
            { date: '20240102', open: 10, close: 10 },
            { date: '20240103', open: 10, close: 12 },
          ],
        },
      ],
    });
    input.strategy = {
      name: 'no factors',
      watch: ['A'],
      onBar(context) {
        if (context.date === input.start) {
          context.stock.orderAdjustedShares('A', 100);
        }
      },
    };

    const result = await new BacktestingEngine(input).run();
    const analysis = result.allocationAnalysis!;

    expect(result.tradeLog).toHaveLength(1);
    expect(analysis.scope).toBe('cash_account');
    expect(analysis.assets).toEqual([
      expect.objectContaining({ assetId: 'A', assetClass: 'other' }),
    ]);
    expect(analysis.reconciliation.reconciled).toBe(true);
    expect(analysis.reconciliation.portfolioPnl).toBeCloseTo(result.finalValue - input.initialCash);
    expect(analysis.assets[0].netPnl).toBeCloseTo(analysis.reconciliation.portfolioPnl);
    expect(analysis.nav).toEqual(result.nav);
    expect(analysis.correlations).toBeUndefined();
  });
});

it.each([{ accounts: { stock: { cashWeight: 1 }, futures: { cashWeight: 0 } } }, { futures: [] }])(
  'rejects legacy declarations before reading market data: %j',
  async (legacy) => {
    const input = config();
    Object.assign(input.strategy, legacy);
    const load = vi.spyOn(input.dataPort, 'openDates');

    await expect(new BacktestingEngine({ ...input, locale: 'en' }).run()).rejects.toThrow(
      'retired',
    );
    expect(load).not.toHaveBeenCalled();
    expect(input.strategy.onBar).not.toHaveBeenCalled();
  },
);

it.each([
  'futureCommissionRate',
  'futureCloseTodayRate',
  'futureSlippageTicks',
  'futureMarginRate',
])('rejects saved retired cost %s before market loading', async (field) => {
  const input = config();
  input.cost = { [field]: 0 };
  const load = vi.spyOn(input.dataPort, 'openDates');

  await expect(new BacktestingEngine({ ...input, locale: 'en' }).run()).rejects.toThrow('retired');
  expect(load).not.toHaveBeenCalled();
});
