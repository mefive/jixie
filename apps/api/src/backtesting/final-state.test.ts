import { describe, expect, it, vi } from 'vitest';
import { fixturePort } from './testing/fixture-port.js';
import type { BacktestingConfig, EngineContext } from './contract.js';
import { BacktestingEngine } from './engine.js';

function config(): BacktestingConfig {
  return {
    start: '20240101',
    end: '20240102',
    initialCash: 10000,
    strategy: {
      name: 'final-state fixture',
      watch: ['A'],
      onBar(context) {
        context.stock.orderLots('A', 1);
        context.stock.stopLossAtAdjustedPrice('A', 18);
      },
    },
    dataPort: fixturePort({
      dates: ['20240101', '20240102'],
      stocks: [
        {
          code: 'A',
          bars: ['20240101', '20240102'].map((date) => ({
            date,
            open: 10,
            high: 10,
            low: 10,
            close: 10,
            adj: 2,
          })),
        },
      ],
    }),
  };
}

describe('explicit final execution state', () => {
  it('rejects capture before and during a run, then returns detached snapshots', async () => {
    const engine = new BacktestingEngine(config());
    await expect(engine.collectFinalState()).rejects.toThrow('successfully completed');

    const running = engine.run();
    await expect(engine.collectFinalState()).rejects.toThrow('successfully completed');
    await running;

    const first = await engine.collectFinalState();
    first.positions[0][1].shares = 999;
    first.pendingLotOrders![0][1] = 999;
    first.conditionalOrders[0][1].code = 'mutated';

    const second = await engine.collectFinalState();
    expect(second.positions[0][1].shares).toBe(50);
    expect(second.pendingLotOrders![0][1]).toBe(1);
    expect(second.conditionalOrders[0][1]).toMatchObject({ code: 'A', triggerPrice: 18 });
  });

  it('does not expose partial state after a strategy failure', async () => {
    const input = config();
    input.strategy.onBar = () => {
      throw new Error('Strategy failed');
    };
    const engine = new BacktestingEngine(input);

    await expect(engine.run()).rejects.toThrow('Strategy failed');
    await expect(engine.collectFinalState()).rejects.toThrow('successfully completed');
  });

  it('loads last-day order quotes only on capture and can retry a failed load', async () => {
    const input = config();
    input.strategy.watch = [];
    input.strategy.onBar = (context) => {
      if (context.date === input.end) {
        context.stock.orderLots('A', 1);
      }
    };
    const barsRows = vi.spyOn(input.dataPort, 'barsRows');
    const engine = new BacktestingEngine(input);

    const result = await engine.run();
    expect(barsRows).not.toHaveBeenCalled();
    expect(result.tradeLog).toEqual([]);

    barsRows.mockRejectedValueOnce(new Error('Quotes unavailable'));
    await expect(engine.collectFinalState()).rejects.toThrow('Quotes unavailable');

    const state = await engine.collectFinalState();
    expect(state.pendingLotOrders).toEqual([['A', 1]]);
    expect(new Map(state.market).get('A')).toMatchObject({ rawClose: 10, adjustmentFactor: 2 });
    expect(result.tradeLog).toEqual([]);
  });

  it('ignores a legacy futures declaration for cash-only final state', async () => {
    const input = config();
    input.strategy.futures = ['UNKNOWN'];

    const engine = new BacktestingEngine(input);
    await engine.run();
    const finalState = await engine.collectFinalState();
    expect(finalState.positions.length).toBe(1);
  });

  it.each([
    (context: EngineContext) => context.futures.orderContracts('IF.CFX', 1),
    (context: EngineContext) => context.futures.setTargetContracts('IF.CFX', 1),
    (context: EngineContext) => context.futures.setTargetNotional('IF.CFX', 1000),
    (context: EngineContext) => context.futures.hedgeStock('IF.CFX'),
    (context: EngineContext) => context.futures.closePosition('IF.CFX'),
  ])('retains futures intents even with zero futures capital', async (action) => {
    const input = config();
    input.strategy.onBar = action;

    const engine = new BacktestingEngine(input);
    await engine.run();
    const finalState = await engine.collectFinalState();
    expect(finalState.futureOrders).toHaveLength(1);
    expect(finalState.futureAccount?.equity).toBe(0);
  });

  it('keeps simulation results identical and retains adjusted state only when requested', async () => {
    const normal = await new BacktestingEngine(config()).run();
    const engine = new BacktestingEngine(config());
    const result = await engine.run();
    const finalState = await engine.collectFinalState();
    expect(result).toEqual(normal);
    expect(finalState).toMatchObject({ tradeDate: '20240102' });
    expect(new Map(finalState.positions).get('A')?.shares).toBe(50);
    expect(new Map(finalState.pendingLotOrders!).get('A')).toBe(1);
    expect(new Map(finalState.market).get('A')).toEqual({
      assetType: 'stock',
      adjustedClose: 20,
      adjustmentFactor: 2,
      rawClose: 10,
    });
    expect([...new Map(finalState.conditionalOrders).values()]).toEqual([
      expect.objectContaining({ kind: 'stop_loss', triggerPrice: 18 }),
    ]);
    expect(finalState).not.toHaveProperty('signals');
  });

  it('retains both funded accounts without changing the execution lifecycle', async () => {
    const input = config();
    const onBar = vi.fn();
    const openDates = vi.spyOn(input.dataPort, 'openDates');
    const engine = new BacktestingEngine({
      ...input,
      strategy: {
        name: 'futures',
        accounts: { stock: { cashWeight: 0.5 }, futures: { cashWeight: 0.5 } },
        onBar,
      },
    });
    await engine.run();
    const finalState = await engine.collectFinalState();
    expect(finalState.futureAccount?.equity).toBe(5000);
    expect(JSON.parse(JSON.stringify(finalState))).toEqual(finalState);
    expect(openDates).toHaveBeenCalled();
    expect(onBar).toHaveBeenCalledTimes(2);
  });
});
