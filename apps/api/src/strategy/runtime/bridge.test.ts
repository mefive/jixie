import type { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { BarContext, OhlcBar } from '#engine/types.js';
import { createStrategyBridge, type StrategyTransport } from './bridge.js';

const metadata = {
  name: 'bridge fixture',
  params: { lookback: 5 },
  factors: ['value'],
  watch: ['AAA', 'MISSING'],
  futures: ['IF'],
  accounts: { stock: { cashWeight: 0.6 }, futures: { cashWeight: 0.4 } },
};
const diagnostics = { language: 'Fixture', callback: 'onBar' };
const history: OhlcBar = {
  date: '20240102',
  adjOpen: 10,
  adjHigh: 12,
  adjLow: 9,
  adjClose: 11,
  vol: 100,
  amount: 1_000,
  turnoverRateF: 2,
};

function transport(frames: unknown[], historyUpdates = false) {
  const sent: Array<{ type: string; [key: string]: unknown }> = [];
  const session: StrategyTransport = {
    historyUpdates,
    async send(frame) {
      sent.push(frame);
    },
    async readValidated<Frame>(schema: z.ZodType<Frame>) {
      if (!frames.length) {
        throw new Error('Fixture exhausted before the bridge completed');
      }
      return schema.parse(frames.shift());
    },
  };
  return { session, sent };
}

function contextFixture() {
  const context = {
    date: '20240102',
    cash: 60,
    value: 100,
    availableCash: 50,
    stockValue: 70,
    futureValue: 30,
    stockAvailableCash: 40,
    futureAvailableCash: 10,
    futureMargin: 20,
    positions: () => [{ code: 'BBB', shares: 100, avgCost: 9, marketValue: 1_100 }],
    bars: vi.fn((code: string) => (code === 'MISSING' ? [] : [history])),
    loadCrossSection: vi.fn(async () => ['AAA', 'MISSING']),
    ensureBars: vi.fn(async () => {}),
    bar: vi.fn((code: string) =>
      code === 'MISSING'
        ? undefined
        : {
            code,
            name: 'Fixture',
            riskWarning: false,
            pendingDelisting: false,
            open: 10,
            high: 12,
            low: 9,
            close: 11,
            adjOpen: 10,
            adjHigh: 12,
            adjLow: 9,
            adjClose: 11,
            vol: 100,
            amount: 1_000,
            peTtm: 8,
          },
    ),
    listDays: () => 100,
    industry: () => 'fixture',
    lhbNet: () => null,
    factor: vi.fn(() => 3),
    orderTargetPercent: vi.fn(),
    setHoldings: vi.fn(),
    order: vi.fn(),
    orderLots: vi.fn(),
    exit: vi.fn(),
    stopLoss: vi.fn(),
    trailingStop: vi.fn(),
    limitBuy: vi.fn(),
    takeProfit: vi.fn(),
    cancelConditional: vi.fn(),
  };
  // Only the bridge's context surface is provided; missing calls must fail the test.
  return { context: context as unknown as BarContext, spies: context };
}

const ready = { type: 'ready', metadata };
const done = { type: 'done', commands: [] };

describe('shared strategy bridge', () => {
  it('maps metadata, startup/bar logs and watch/holding snapshots without transport ownership', async () => {
    const { session, sent } = transport([
      { type: 'log', level: 'warning', text: 'startup' },
      ready,
      { type: 'log', level: 'error', text: 'bar' },
      done,
    ]);
    const onUserLog = vi.fn();
    const strategy = await createStrategyBridge(session, { diagnostics, onUserLog });
    const { context, spies } = contextFixture();
    expect(strategy).toMatchObject(metadata);
    await strategy.onBar(context);
    expect(onUserLog.mock.calls).toEqual([
      ['warn', 'startup'],
      ['error', 'bar'],
    ]);
    expect(spies.bars.mock.calls).toEqual([
      ['AAA', 1],
      ['MISSING', 1],
      ['BBB', 1],
    ]);
    expect(sent).toEqual([
      {
        type: 'bar',
        snapshot: {
          date: '20240102',
          cash: 60,
          value: 100,
          available_cash: 50,
          stock_value: 70,
          future_value: 30,
          stock_available_cash: 40,
          future_available_cash: 10,
          future_margin: 20,
          positions: [{ code: 'BBB', shares: 100, avg_cost: 9, market_value: 1_100 }],
          bar_updates: {
            AAA: {
              date: '20240102',
              adj_open: 10,
              adj_high: 12,
              adj_low: 9,
              adj_close: 11,
              vol: 100,
              amount: 1_000,
              turnover_rate_f: 2,
            },
            BBB: {
              date: '20240102',
              adj_open: 10,
              adj_high: 12,
              adj_low: 9,
              adj_close: 11,
              vol: 100,
              amount: 1_000,
              turnover_rate_f: 2,
            },
          },
        },
      },
    ]);
  });

  it('batches cross-section factors and history requests with matching response IDs', async () => {
    const { session, sent } = transport([
      ready,
      { type: 'request', id: 7, method: 'cross_section', arguments: { index_code: 'INDEX' } },
      { type: 'request', id: 8, method: 'bars', arguments: { codes: ['AAA', 'BBB'] } },
      done,
    ]);
    const strategy = await createStrategyBridge(session, { diagnostics });
    const { context, spies } = contextFixture();
    await strategy.onBar(context);
    expect(spies.loadCrossSection).toHaveBeenCalledExactlyOnceWith('INDEX');
    expect(spies.factor).toHaveBeenCalledExactlyOnceWith('value', 'AAA');
    expect(spies.ensureBars).toHaveBeenCalledExactlyOnceWith(['AAA', 'BBB']);
    expect(sent[1]).toMatchObject({
      type: 'response',
      id: 7,
      result: {
        codes: ['AAA', 'MISSING'],
        rows: [{ code: 'AAA', pe_ttm: 8, factors: { value: 3 }, list_days: 100 }],
      },
    });
    expect(sent[2]).toMatchObject({
      type: 'response',
      id: 8,
      result: {
        bars: { AAA: [{ adj_close: 11 }], BBB: [{ adj_close: 11 }] },
      },
    });
    expect(spies.bars).toHaveBeenCalledWith('AAA', Number.MAX_SAFE_INTEGER);
  });

  it('reports query failures to the sandbox and continues to its final commands', async () => {
    const { session, sent } = transport([
      ready,
      { type: 'request', id: 9, method: 'bars', arguments: { codes: ['AAA'] } },
      { type: 'done', commands: [{ operation: 'exit', arguments: { code: 'BBB' } }] },
    ]);
    const strategy = await createStrategyBridge(session, { diagnostics });
    const { context, spies } = contextFixture();
    spies.ensureBars.mockRejectedValueOnce(new Error('history unavailable'));
    await strategy.onBar(context);
    expect(sent[1]).toEqual({ type: 'response', id: 9, error: 'history unavailable' });
    expect(spies.exit).toHaveBeenCalledExactlyOnceWith('BBB');
  });

  it('replays all supported trading commands in their original order', async () => {
    const commands = [
      { operation: 'order_target_percent', arguments: { code: 'AAA', weight: 0.5 } },
      { operation: 'set_holdings', arguments: { weights: { AAA: 0.6 } } },
      { operation: 'order', arguments: { code: 'AAA', shares: 100 } },
      { operation: 'order_lots', arguments: { code: 'IF', lots: -1 } },
      { operation: 'exit', arguments: { code: 'BBB' } },
      { operation: 'stop_loss', arguments: { code: 'AAA', price: 9 } },
      { operation: 'trailing_stop', arguments: { code: 'AAA', percentage: 0.1 } },
      { operation: 'limit_buy', arguments: { code: 'AAA', price: 10, shares: 200 } },
      { operation: 'take_profit', arguments: { code: 'AAA', percentage: 0.2 } },
      { operation: 'cancel_conditional', arguments: { code: 'AAA', kind: null } },
    ];
    const { session } = transport([ready, { type: 'done', commands }]);
    const strategy = await createStrategyBridge(session, { diagnostics });
    const { context, spies } = contextFixture();
    await strategy.onBar(context);
    const calls = [
      spies.orderTargetPercent,
      spies.setHoldings,
      spies.order,
      spies.orderLots,
      spies.exit,
      spies.stopLoss,
      spies.trailingStop,
      spies.limitBuy,
      spies.takeProfit,
      spies.cancelConditional,
    ];
    expect(calls.map((spy) => spy.mock.calls)).toEqual([
      [['AAA', 0.5]],
      [[{ AAA: 0.6 }]],
      [['AAA', 100]],
      [['IF', -1]],
      [['BBB']],
      [['AAA', 9]],
      [['AAA', 0.1]],
      [['AAA', 10, 200]],
      [['AAA', 0.2]],
      [['AAA', undefined]],
    ]);
    const order = calls.map((spy) => spy.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it('validates the entire command batch before any engine mutation', async () => {
    const { session } = transport([
      ready,
      {
        type: 'done',
        commands: [
          { operation: 'exit', arguments: { code: 'AAA' } },
          { operation: 'order', arguments: { code: 'AAA', shares: Infinity } },
        ],
      },
    ]);
    const strategy = await createStrategyBridge(session, { diagnostics });
    const { context, spies } = contextFixture();
    await expect(strategy.onBar(context)).rejects.toThrow();
    expect(spies.exit).not.toHaveBeenCalled();
    expect(spies.order).not.toHaveBeenCalled();
  });

  it('preserves sandbox errors during initialization and onBar', async () => {
    const startup = transport([{ type: 'fatal', message: 'startup traceback' }]);
    await expect(createStrategyBridge(startup.session, { diagnostics })).rejects.toThrow(
      'startup traceback',
    );
    const execution = transport([ready, { type: 'error', message: 'bar traceback' }]);
    const strategy = await createStrategyBridge(execution.session, { diagnostics });
    await expect(strategy.onBar(contextFixture().context)).rejects.toThrow('bar traceback');
  });

  it('normalizes absent account allocation without inventing defaults', async () => {
    const { session } = transport([{ type: 'ready', metadata: { ...metadata, accounts: null } }]);
    const strategy = await createStrategyBridge(session, { diagnostics });
    expect(strategy.accounts).toBeUndefined();
  });
});

describe('incremental TypeScript history delivery', () => {
  const ensure = (id: number, codes: string[]) => ({
    type: 'request',
    id,
    method: 'context_data',
    arguments: { operation: 'ensure_bars', codes },
  });
  const startup = { type: 'ready', metadata: { ...metadata, watch: [] } };

  it('sends each visible row once across mixed requests, repeated calls, gaps and suspended dates', async () => {
    const frames: unknown[] = [startup];
    const { session, sent } = transport(frames, true);
    const strategy = await createStrategyBridge(session, { diagnostics });
    const { context, spies } = contextFixture();
    const rows = ['20240102', '20240103', '20240105'].map((date) => ({ ...history, date }));
    const loaded = new Set<string>();
    context.positions = () => [];
    context.bars = (code, count) =>
      loaded.has(code) ? rows.filter((row) => row.date <= context.date).slice(-count) : [];
    context.ensureBars = vi.fn(async (codes: string[]) => {
      codes.forEach((code) => loaded.add(code));
    });

    frames.push(ensure(1, ['AAA']), ensure(2, ['AAA', 'BBB']), ensure(3, ['AAA']), done);
    await strategy.onBar(context);
    expect(sent.filter((frame) => frame.type === 'response')).toEqual([
      {
        type: 'response',
        id: 1,
        result: { history_updates: { AAA: { reset: true, bars: [rows[0]] } } },
      },
      {
        type: 'response',
        id: 2,
        result: { history_updates: { BBB: { reset: true, bars: [rows[0]] } } },
      },
      { type: 'response', id: 3, result: { history_updates: {} } },
    ]);

    // Skip a callback on Jan 3: the Jan 4 snapshot must catch up without a synthetic suspended bar.
    for (const date of ['20240104', '20240105']) {
      spies.date = date;
      frames.push(ensure(4, ['AAA', 'BBB']), done);
      await strategy.onBar(context);
      expect(sent.at(-1)).toEqual({ type: 'response', id: 4, result: { history_updates: {} } });
    }
    const snapshots = sent.filter((frame) => frame.type === 'bar');
    expect(snapshots[1]).toMatchObject({
      snapshot: {
        history_updates: {
          AAA: { reset: false, bars: [rows[1]] },
          BBB: { reset: false, bars: [rows[1]] },
        },
      },
    });
    expect(snapshots[2]).toMatchObject({
      snapshot: {
        history_updates: {
          AAA: { reset: false, bars: [rows[2]] },
          BBB: { reset: false, bars: [rows[2]] },
        },
      },
    });
    // Every request still reaches Engine, including its factor-preparation hook.
    expect(context.ensureBars).toHaveBeenCalledTimes(5);
  });

  it('does not mark failed loads as synchronized and initializes empty histories only once', async () => {
    const { session, sent } = transport(
      [
        startup,
        ensure(1, ['NEW']),
        ensure(2, ['NEW']),
        ensure(3, ['EMPTY']),
        ensure(4, ['EMPTY']),
        done,
      ],
      true,
    );
    const strategy = await createStrategyBridge(session, { diagnostics });
    const { context, spies } = contextFixture();
    context.positions = () => [];
    context.bars = (code) => (code === 'EMPTY' ? [] : [history]);
    spies.ensureBars.mockRejectedValueOnce(new Error('load failed'));
    await strategy.onBar(context);
    expect(sent.slice(1)).toEqual([
      { type: 'response', id: 1, error: 'load failed' },
      {
        type: 'response',
        id: 2,
        result: { history_updates: { NEW: { reset: true, bars: [history] } } },
      },
      {
        type: 'response',
        id: 3,
        result: { history_updates: { EMPTY: { reset: true, bars: [] } } },
      },
      { type: 'response', id: 4, result: { history_updates: {} } },
    ]);
    expect(spies.ensureBars).toHaveBeenCalledTimes(4);
  });
});
