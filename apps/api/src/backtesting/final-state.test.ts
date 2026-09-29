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
        context.orderLots('A', 1);
        context.stopLoss('A', 18);
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

describe('optional final execution state', () => {
  it('ignores a legacy futures declaration for cash-only final state', async () => {
    const input = config();
    input.strategy.futures = ['UNKNOWN'];

    const result = await new BacktestingEngine({ ...input, retainFinalState: true }).run();
    expect(result.finalState?.positions.size).toBe(1);
  });

  it.each([
    (context: EngineContext) => context.orderFuture('IF.CFX', 1),
    (context: EngineContext) => context.setFutureTargetContracts('IF.CFX', 1),
    (context: EngineContext) => context.setFutureTargetNotional('IF.CFX', 1000),
    (context: EngineContext) => context.hedgeFuture('IF.CFX'),
    (context: EngineContext) => context.exitFuture('IF.CFX'),
  ])('rejects futures intents even with zero futures capital', async (action) => {
    const input = config();
    input.strategy.onBar = action;

    await expect(new BacktestingEngine({ ...input, retainFinalState: true }).run()).rejects.toThrow(
      'Final state retention currently supports stock and ETF strategies only',
    );
  });

  it('keeps simulation results identical and retains adjusted state only when requested', async () => {
    const normal = await new BacktestingEngine(config()).run();
    const retained = await new BacktestingEngine({ ...config(), retainFinalState: true }).run();
    expect(normal.finalState).toBeNull();
    expect(retained.result).toEqual(normal.result);
    expect(retained.finalState).toMatchObject({ tradeDate: '20240102' });
    expect(retained.finalState!.positions.get('A')?.shares).toBe(50);
    expect(retained.finalState!.pendingLotOrders!.get('A')).toBe(1);
    expect(retained.finalState!.market.get('A')).toEqual({
      assetType: 'stock',
      adjustedClose: 20,
      adjustmentFactor: 2,
      rawClose: 10,
    });
    expect([...retained.finalState!.conditionalOrders.values()]).toEqual([
      expect.objectContaining({ kind: 'stop_loss', triggerPrice: 18 }),
    ]);
    expect(retained.finalState).not.toHaveProperty('signals');
  });

  it('rejects unsupported futures state before market reads or strategy execution', async () => {
    const input = config();
    const onBar = vi.fn();
    const openDates = vi.spyOn(input.dataPort, 'openDates');
    await expect(
      new BacktestingEngine({
        ...input,
        retainFinalState: true,
        strategy: {
          name: 'futures',
          accounts: { stock: { cashWeight: 0.5 }, futures: { cashWeight: 0.5 } },
          onBar,
        },
      }).run(),
    ).rejects.toThrow('Final state retention currently supports stock and ETF strategies only');
    expect(openDates).not.toHaveBeenCalled();
    expect(onBar).not.toHaveBeenCalled();
  });
});
