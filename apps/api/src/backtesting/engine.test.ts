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
    expect(output.result.nav).toEqual([
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

describe('disabled futures', () => {
  it('keeps all initial cash in stocks and omits futures analysis', async () => {
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
      name: 'disabled futures',
      accounts: { stock: { cashWeight: 0.2 }, futures: { cashWeight: 0.8 } },
      onBar,
    };

    const { result } = await new BacktestingEngine(input).run();

    expect(onBar).toHaveBeenCalledTimes(2);
    expect(futuresRange).not.toHaveBeenCalled();
    expect(result.sleeveNav).toBeUndefined();
    expect(result.finalValue).toBe(input.initialCash);
    expect(result.tradeLog).toEqual([]);
    expect(result.allocationAnalysis).toMatchObject({
      scope: 'cash_account',
      assets: [],
      nav: result.nav,
      reconciliation: { portfolioPnl: 0, reconciled: true },
    });
  });

  it.each([
    ['order', (context: EngineContext) => context.orderFuture('IF.CFX', 1)],
    ['contracts', (context: EngineContext) => context.setFutureTargetContracts('IF.CFX', 1)],
    ['notional', (context: EngineContext) => context.setFutureTargetNotional('IF.CFX', 1000)],
    ['hedge', (context: EngineContext) => context.hedgeFuture('IF.CFX')],
    ['exit', (context: EngineContext) => context.exitFuture('IF.CFX')],
  ] as const)(
    'rejects %s instructions even though a zero-cash account exists',
    async (_name, action) => {
      const input = config();
      input.strategy.onBar = action;

      await expect(new BacktestingEngine(input).run()).rejects.toThrow(
        'Declare strategy.futures to use futures orders',
      );
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

    const { result } = await new BacktestingEngine(input).run();
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
