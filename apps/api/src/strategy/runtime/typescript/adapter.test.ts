import { expect, it, vi } from 'vitest';
import { StrategyAdapter, type StrategyAdapterInput } from './adapter.js';
import { defineStrategy, StrategyContext } from '../../sdk/typescript.js';
import type { StrategyCapabilities } from '../../sdk/capabilities.js';
import type { OhlcBar } from '#backtesting/data/market.js';

function snapshot(date: string, equity: number): StrategyAdapterInput {
  return {
    date,
    portfolio: { equity },
    stock: { equity, availableCash: equity, positions: [] },
    futures: { equity: 0, availableCash: 0, margin: 0 },
  };
}

function bar(date: string, close: number): OhlcBar {
  return {
    date,
    vol: 100,
    amount: 1000,
    turnoverRateF: null,
    adjOpen: close,
    adjHigh: close,
    adjLow: close,
    adjClose: close,
  };
}

it('reuses session history while keeping dates, snapshots and returned data independent', () => {
  const access = vi.fn(() => JSON.stringify({ result: 'banking' }));
  const adapter = new StrategyAdapter({ access, request: vi.fn() });
  const first = adapter.bind({
    ...snapshot('20260105', 1000),
    history_updates: { AAA: { reset: true, bars: [bar('20260105', 10)] } },
  });
  expect(first.industry('AAA')).toBe('banking');
  expect(first.industry('AAA')).toBe('banking');
  expect(access).toHaveBeenCalledTimes(1);
  const copy = first.bars('AAA', 1);
  copy[0].adjClose = -1;

  const second = adapter.bind({
    ...snapshot('20260106', 1200),
    history_updates: { AAA: { reset: false, bars: [bar('20260106', 12)] } },
  });
  expect(second.history('AAA', 'close', 2)).toEqual([10, 12]);
  expect(first.date).toBe('20260105');
  expect(first.stock.equity).toBe(1000);
  expect(second.stock.equity).toBe(1200);
  second.industry('AAA');
  expect(access).toHaveBeenCalledTimes(2);
});

it('keeps host commands synchronous through the SDK account wrapper', async () => {
  const commands: unknown[] = [];
  const access = vi.fn((json: string) => {
    commands.push(JSON.parse(json));

    return JSON.stringify({ result: null });
  });
  const adapter = new StrategyAdapter({ access, request: vi.fn() });
  const strategy = defineStrategy({
    name: 'bound-account',
    onBar(context) {
      const { setTargetWeight } = context.stock;
      setTargetWeight('AAA', 0.5);
      expect(commands).toHaveLength(1);
      context.stock.setTargetWeights(new Map([['BBB', 0.25]]));
      context.stock.cancelConditional('AAA');
    },
  });

  const capabilities = adapter.bind(snapshot('20260105', 1000));
  const context = new StrategyContext(capabilities, strategy.params);

  await strategy.onBar(context);

  expect(commands).toEqual([
    {
      type: 'command',
      command: { operation: 'stock.setTargetWeight', arguments: { code: 'AAA', weight: 0.5 } },
    },
    {
      type: 'command',
      command: { operation: 'stock.setTargetWeights', arguments: { weights: { BBB: 0.25 } } },
    },
    {
      type: 'command',
      command: { operation: 'stock.cancelConditional', arguments: { code: 'AAA', kind: null } },
    },
  ]);
});

it('keeps cross-sections scoped to their binding and invalidates reads after loading', async () => {
  const access = vi.fn(() => JSON.stringify({ result: null }));
  const request = vi.fn(async () => ({ codes: ['AAA'], rows: [['AAA', { code: 'AAA' }]] }));
  const adapter = new StrategyAdapter({ access, request });
  const first: StrategyCapabilities = adapter.bind(snapshot('20260105', 1000));
  first.factor('factor-1', 'AAA');
  await first.loadCrossSection();
  first.factor('factor-1', 'AAA');
  const second = adapter.bind(snapshot('20260106', 1200));

  expect(first.bar('AAA')).toEqual({ code: 'AAA' });
  expect(second.bar('AAA')).toBeNull();
  expect(access).toHaveBeenCalledTimes(2);
});
