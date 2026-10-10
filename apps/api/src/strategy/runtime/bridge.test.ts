import type { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { EngineContext } from '#backtesting/contract.js';
import type { OhlcBar } from '#backtesting/data/market.js';
import { StrategyBridge, type StrategyTransport } from './bridge.js';
import type { StrategyBridgeContract } from './contract.js';

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
  return { session, sent, historyUpdates };
}

function contextFixture() {
  const context = {
    date: '20240102',
    portfolio: { equity: 100 },
    stock: {
      equity: 70,
      availableCash: 40,
      positions: () => [{ code: 'BBB', shares: 100, avgCost: 9, marketValue: 1_100 }],
      setTargetWeight: vi.fn(),
      setTargetWeights: vi.fn(),
      orderAdjustedShares: vi.fn(),
      orderLots: vi.fn(),
      closePosition: vi.fn(),
      stopLossAtAdjustedPrice: vi.fn(),
      trailingStopByFraction: vi.fn(),
      limitBuyAtAdjustedPrice: vi.fn(),
      takeProfitByFraction: vi.fn(),
      cancelConditional: vi.fn(),
    },
    futures: {
      equity: 30,
      availableCash: 10,
      margin: 20,
      orderContracts: vi.fn(),
      setTargetContracts: vi.fn(),
      setTargetNotional: vi.fn(),
      hedgeStock: vi.fn(),
      closePosition: vi.fn(),
    },
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
  };
  // Only the bridge's context surface is provided; missing calls must fail the test.
  return { context: context as unknown as EngineContext, spies: context };
}

const ready = { type: 'ready', metadata };
const done = { type: 'done', commands: [] };

describe('shared strategy bridge', () => {
  it('passes startup cancellation through the shared Bridge contract before send and after read', async () => {
    const { session, sent } = transport([ready]);
    const bridge: StrategyBridgeContract = new StrategyBridge(session, {
      startupCommand: { type: 'start' },
      diagnostics,
    });
    const cancelled = new Error('startup cancelled');

    await expect(bridge.initialize({ signal: AbortSignal.abort(cancelled) })).rejects.toBe(
      cancelled,
    );
    expect(sent).toEqual([]);

    const controller = new AbortController();
    const read = session.readValidated.bind(session);
    session.readValidated = async <Frame>(schema: z.ZodType<Frame>, operation: string) => {
      const frame = await read(schema, operation);
      controller.abort(cancelled);

      return frame;
    };

    await expect(bridge.initialize({ signal: controller.signal })).rejects.toBe(cancelled);
    expect(sent).toEqual([{ type: 'start' }]);
  });

  it('maps metadata, startup/bar logs and watch/holding snapshots without transport ownership', async () => {
    const { session, sent, historyUpdates } = transport([
      { type: 'log', level: 'warning', text: 'startup' },
      ready,
      { type: 'log', level: 'error', text: 'bar' },
      done,
    ]);
    const onUserLog = vi.fn();
    const strategy = new StrategyBridge(session, {
      startupCommand: { type: 'start' },
      historyUpdates,
      diagnostics,
      onUserLog,
    });
    const initialized = await strategy.initialize();

    const { context, spies } = contextFixture();
    expect(initialized).toMatchObject({ ...metadata, futures: [] });
    await strategy.execute({ context });
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
      { type: 'start' },
      {
        type: 'bar',
        snapshot: {
          date: '20240102',
          portfolio: { equity: 100 },
          stock: {
            equity: 70,
            availableCash: 40,
            positions: [{ code: 'BBB', shares: 100, avgCost: 9, marketValue: 1_100 }],
          },
          futures: { equity: 30, availableCash: 10, margin: 20 },
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
    const { session, sent, historyUpdates } = transport([
      ready,
      { type: 'request', id: 7, method: 'cross_section', arguments: { index_code: 'INDEX' } },
      { type: 'request', id: 8, method: 'bars', arguments: { codes: ['AAA', 'BBB'] } },
      done,
    ]);
    const strategy = new StrategyBridge(session, {
      startupCommand: { type: 'start' },
      historyUpdates,
      diagnostics,
    });
    await strategy.initialize();

    const { context, spies } = contextFixture();
    await strategy.execute({ context });
    expect(spies.loadCrossSection).toHaveBeenCalledExactlyOnceWith('INDEX');
    expect(spies.factor).toHaveBeenCalledExactlyOnceWith('value', 'AAA');
    expect(spies.ensureBars).toHaveBeenCalledExactlyOnceWith(['AAA', 'BBB']);
    expect(sent[2]).toMatchObject({
      type: 'response',
      id: 7,
      result: {
        codes: ['AAA', 'MISSING'],
        rows: [{ code: 'AAA', pe_ttm: 8, factors: { value: 3 }, list_days: 100 }],
      },
    });
    expect(sent[3]).toMatchObject({
      type: 'response',
      id: 8,
      result: {
        bars: { AAA: [{ adj_close: 11 }], BBB: [{ adj_close: 11 }] },
      },
    });
    expect(spies.bars).toHaveBeenCalledWith('AAA', Number.MAX_SAFE_INTEGER);
  });

  it('reports query failures to the sandbox and continues to its final commands', async () => {
    const { session, sent, historyUpdates } = transport([
      ready,
      { type: 'request', id: 9, method: 'bars', arguments: { codes: ['AAA'] } },
      {
        type: 'done',
        commands: [{ operation: 'stock.closePosition', arguments: { code: 'BBB' } }],
      },
    ]);
    const strategy = new StrategyBridge(session, {
      startupCommand: { type: 'start' },
      historyUpdates,
      diagnostics,
    });
    await strategy.initialize();

    const { context, spies } = contextFixture();
    spies.ensureBars.mockRejectedValueOnce(new Error('history unavailable'));
    await strategy.execute({ context });
    expect(sent[2]).toEqual({ type: 'response', id: 9, error: 'history unavailable' });
    expect(spies.stock.closePosition).toHaveBeenCalledExactlyOnceWith('BBB');
  });

  it('replays all supported trading commands in their original order', async () => {
    const commands = [
      { operation: 'stock.setTargetWeight', arguments: { code: 'AAA', weight: 0.5 } },
      { operation: 'stock.setTargetWeights', arguments: { weights: { AAA: 0.6 } } },
      { operation: 'stock.orderAdjustedShares', arguments: { code: 'AAA', shares: 100 } },
      { operation: 'stock.orderLots', arguments: { code: 'IF', lots: -1 } },
      { operation: 'stock.closePosition', arguments: { code: 'BBB' } },
      { operation: 'stock.stopLossAtAdjustedPrice', arguments: { code: 'AAA', price: 9 } },
      { operation: 'stock.trailingStopByFraction', arguments: { code: 'AAA', percentage: 0.1 } },
      {
        operation: 'stock.limitBuyAtAdjustedPrice',
        arguments: { code: 'AAA', price: 10, shares: 200 },
      },
      { operation: 'stock.takeProfitByFraction', arguments: { code: 'AAA', percentage: 0.2 } },
      { operation: 'stock.cancelConditional', arguments: { code: 'AAA', kind: null } },
      { operation: 'futures.orderContracts', arguments: { code: 'IF', contracts: -2 } },
      { operation: 'futures.setTargetContracts', arguments: { code: 'IF', contracts: 3 } },
      { operation: 'futures.setTargetNotional', arguments: { code: 'IF', notional: -100000 } },
      { operation: 'futures.hedgeStock', arguments: { code: 'IF', beta: 1 } },
      { operation: 'futures.closePosition', arguments: { code: 'IF' } },
    ];
    const { session, historyUpdates } = transport([ready, { type: 'done', commands }]);
    const strategy = new StrategyBridge(session, {
      startupCommand: { type: 'start' },
      historyUpdates,
      diagnostics,
    });
    await strategy.initialize();

    const { context, spies } = contextFixture();
    await strategy.execute({ context });
    const calls = [
      spies.stock.setTargetWeight,
      spies.stock.setTargetWeights,
      spies.stock.orderAdjustedShares,
      spies.stock.orderLots,
      spies.stock.closePosition,
      spies.stock.stopLossAtAdjustedPrice,
      spies.stock.trailingStopByFraction,
      spies.stock.limitBuyAtAdjustedPrice,
      spies.stock.takeProfitByFraction,
      spies.stock.cancelConditional,
      spies.futures.orderContracts,
      spies.futures.setTargetContracts,
      spies.futures.setTargetNotional,
      spies.futures.hedgeStock,
      spies.futures.closePosition,
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
      [['IF', -2]],
      [['IF', 3]],
      [['IF', -100000]],
      [['IF', 1]],
      [['IF']],
    ]);
    const order = calls.map((spy) => spy.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it('validates the entire command batch before any engine mutation', async () => {
    const { session, historyUpdates } = transport([
      ready,
      {
        type: 'done',
        commands: [
          { operation: 'stock.closePosition', arguments: { code: 'AAA' } },
          { operation: 'stock.orderAdjustedShares', arguments: { code: 'AAA', shares: Infinity } },
        ],
      },
    ]);
    const strategy = new StrategyBridge(session, {
      startupCommand: { type: 'start' },
      historyUpdates,
      diagnostics,
    });
    await strategy.initialize();

    const { context, spies } = contextFixture();
    await expect(strategy.execute({ context })).rejects.toThrow();
    expect(spies.stock.closePosition).not.toHaveBeenCalled();
    expect(spies.stock.orderAdjustedShares).not.toHaveBeenCalled();
  });

  it('preserves sandbox errors during initialization and onBar', async () => {
    const startup = transport([{ type: 'fatal', message: 'startup traceback' }]);
    await expect(
      new StrategyBridge(startup.session, {
        startupCommand: { type: 'start' },
        diagnostics,
      }).initialize(),
    ).rejects.toThrow('startup traceback');
    const execution = transport([ready, { type: 'error', message: 'bar traceback' }]);
    const strategy = new StrategyBridge(execution.session, {
      startupCommand: { type: 'start' },
      diagnostics,
    });
    await strategy.initialize();

    await expect(strategy.execute({ context: contextFixture().context })).rejects.toThrow(
      'bar traceback',
    );
  });

  it('normalizes absent account allocation without inventing defaults', async () => {
    const { session, historyUpdates } = transport([
      { type: 'ready', metadata: { ...metadata, accounts: null } },
    ]);
    const strategy = new StrategyBridge(session, {
      startupCommand: { type: 'start' },
      historyUpdates,
      diagnostics,
    });
    const initialized = await strategy.initialize();

    expect(initialized.accounts).toBeUndefined();
  });

  it('binds the current context only during execution and unbinds after sandbox failure', async () => {
    const { session } = transport([ready, done, { type: 'error', message: 'bar failed' }]);
    let hostAccess: ((input: unknown) => unknown) | undefined;
    const bindings: Array<((input: unknown) => unknown) | undefined> = [];
    session.setHostAccess = (handler) => {
      hostAccess = handler;
      bindings.push(handler);
    };
    const send = session.send.bind(session);
    const values: unknown[] = [];
    session.send = async (frame) => {
      if (frame.type === 'bar') {
        values.push(hostAccess?.({ type: 'read', request: { method: 'industry', args: ['AAA'] } }));
      }

      await send(frame);
    };
    const strategy = new StrategyBridge(session, {
      startupCommand: { type: 'start' },
      diagnostics,
    });
    await strategy.initialize();
    expect(bindings).toEqual([]);

    const first = contextFixture().context;
    const second = { ...first, industry: () => 'second context' };
    await strategy.execute({ context: first });
    expect(hostAccess).toBeUndefined();
    await expect(strategy.execute({ context: second })).rejects.toThrow('bar failed');
    expect(hostAccess).toBeUndefined();
    expect(values).toEqual(['fixture', 'second context']);
    expect(bindings).toEqual([expect.any(Function), undefined, expect.any(Function), undefined]);
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
    const { session, sent, historyUpdates } = transport(frames, true);
    const strategy = new StrategyBridge(session, {
      startupCommand: { type: 'start' },
      historyUpdates,
      diagnostics,
    });
    await strategy.initialize();

    const { context, spies } = contextFixture();
    const rows = ['20240102', '20240103', '20240105'].map((date) => ({ ...history, date }));
    const loaded = new Set<string>();
    context.stock.positions = () => [];
    context.bars = (code, count) =>
      loaded.has(code) ? rows.filter((row) => row.date <= context.date).slice(-count) : [];
    context.ensureBars = vi.fn(async (codes: string[]) => {
      codes.forEach((code) => loaded.add(code));
    });

    frames.push(ensure(1, ['AAA']), ensure(2, ['AAA', 'BBB']), ensure(3, ['AAA']), done);
    await strategy.execute({ context });
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
      await strategy.execute({ context });
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
    const { session, sent, historyUpdates } = transport(
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
    const strategy = new StrategyBridge(session, {
      startupCommand: { type: 'start' },
      historyUpdates,
      diagnostics,
    });
    await strategy.initialize();

    const { context, spies } = contextFixture();
    context.stock.positions = () => [];
    context.bars = (code) => (code === 'EMPTY' ? [] : [history]);
    spies.ensureBars.mockRejectedValueOnce(new Error('load failed'));
    await strategy.execute({ context });
    expect(sent.slice(2)).toEqual([
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
