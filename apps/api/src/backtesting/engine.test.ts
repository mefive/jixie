import { describe, expect, it, vi } from 'vitest';
import { fixturePort } from './testing/fixture-port.js';
import { BacktestingEngine } from './engine.js';
import type { BacktestingConfig, EngineContext } from './contract.js';

function config(): BacktestingConfig {
  return {
    start: '20240102',
    end: '20240103',
    initialCash: 10000,
    dataPort: fixturePort({ dates: ['20240102', '20240103'], stocks: [] }),
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

describe('initial account allocation', () => {
  it('honors account weights without declaring futures', async () => {
    const input = config();
    input.strategy.accounts = { stock: { cashWeight: 0.2 }, futures: { cashWeight: 0.8 } };
    input.strategy.onBar = (context) => {
      expect(context.stockValue).toBe(2000);
      expect(context.futureValue).toBe(8000);
      expect(context.value).toBe(10000);
    };

    const result = await new BacktestingEngine(input).run();
    expect(result.sleeveNav?.at(-1)).toMatchObject({ stockValue: 2000, futureValue: 8000 });
  });

  it.each([
    { stock: { cashWeight: -0.1 }, futures: { cashWeight: 1.1 } },
    { stock: { cashWeight: 0.2 }, futures: { cashWeight: 0.5 } },
    { stock: { cashWeight: NaN }, futures: { cashWeight: 0 } },
  ])('validates account weights without a futures declaration', async (accounts) => {
    const input = config();
    input.strategy.accounts = accounts;

    await expect(new BacktestingEngine(input).run()).rejects.toThrow(/cash weights/);
  });

  it.each([undefined, [], ['UNKNOWN']])(
    'defaults to cash regardless of legacy futures %j',
    async (futures) => {
      const input = config();
      const futuresRange = vi.spyOn(input.dataPort, 'futuresRange');
      const onBar = vi.fn((context: EngineContext) => {
        expect(context.cash).toBe(input.initialCash);
        expect(context.value).toBe(input.initialCash);
        expect(context.availableCash).toBe(input.initialCash);
        expect(context.stockValue).toBe(input.initialCash);
        expect(context.futureValue).toBe(0);
        expect(context.futureAvailableCash).toBe(0);
        expect(context.futureMargin).toBe(0);
        expect(context.future('IF.CFX')).toBeNull();
        expect(context.futureHistory('IF.CFX', 'close', 2)).toEqual([]);
        expect(context.futurePosition('IF.CFX')).toBeNull();
      });
      input.strategy = {
        name: 'default accounts',
        futures,
        onBar,
      };

      const result = await new BacktestingEngine(input).run();

      expect(onBar).toHaveBeenCalledTimes(2);
      expect(futuresRange).toHaveBeenCalledWith(input.start, input.end);
      expect(result.sleeveNav?.map((point) => point.futureValue)).toEqual([0, 0]);
      expect(result.finalValue).toBe(input.initialCash);
      expect(result.tradeLog).toEqual([]);
      expect(result.allocationAnalysis).toMatchObject({
        scope: 'cash_account',
        assets: [],
        nav: result.nav,
        reconciliation: { portfolioPnl: 0, reconciled: true },
      });
    },
  );

  it.each([
    ['order', (context: EngineContext) => context.orderFuture('IF.CFX', 1)],
    ['contracts', (context: EngineContext) => context.setFutureTargetContracts('IF.CFX', 1)],
    ['notional', (context: EngineContext) => context.setFutureTargetNotional('IF.CFX', 1000)],
    ['hedge', (context: EngineContext) => context.hedgeFuture('IF.CFX')],
    ['exit', (context: EngineContext) => context.exitFuture('IF.CFX')],
  ] as const)(
    'accepts %s instructions without a declaration and cannot fill without data or capital',
    async (_name, action) => {
      const input = config();
      input.strategy.onBar = action;

      const result = await new BacktestingEngine(input).run();
      expect(result.tradeLog).toEqual([]);
      expect(result.finalValue).toBe(input.initialCash);
    },
  );
});

describe('cash-account attribution without factors', () => {
  it('attributes stock trades without factor metadata and marks their class as other', async () => {
    const input = config();
    input.dataPort = fixturePort({
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
          context.order('A', 100);
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
    expect(analysis.rateRegimes).toBeUndefined();
  });
});
