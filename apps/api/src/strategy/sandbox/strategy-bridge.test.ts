import type { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { EngineContext } from '#backtesting/contract.js';
import type { OhlcBar } from '#backtesting/data/market.js';
import { StrategyBridge, type StrategyTransport } from './strategy-bridge.js';
import type { StrategyBridgeOptions } from './strategy-bridge.js';
import { TypeScriptTransport } from '#infra/sandbox/typescript/typescript-transport.js';
import type { SandboxBridge } from '#infra/sandbox/sandbox-bridge.js';
import type { StrategyDecisionInput, StrategySandboxMetadata } from './contract.js';

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
    close: vi.fn(),
    abort: vi.fn(),
    isClosed: false,
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

const ready = { type: 'ready', command_mode: 'synchronous', metadata };
const done = { type: 'done' };
const commandRequest = (id: number, command: unknown) => ({
  type: 'request',
  id,
  method: 'command',
  arguments: command,
});

describe('Strategy Bridge connection creation', () => {
  it('defers user source execution until initialize after creating the connection', async () => {
    const bridge = await StrategyBridge.create({
      language: 'typescript',
      code: "throw new Error('user source ran');",
    });

    try {
      expect(bridge.isClosed).toBe(false);
      await expect(bridge.initialize()).rejects.toThrow('user source ran');
    } finally {
      bridge.close();
    }
  });

  it.each([false, true])(
    'reclaims a connection and preserves construction errors when cleanup throws: %s',
    async (cleanupThrows) => {
      const failure = new Error('bridge construction failed');
      let opened: StrategyTransport | undefined;

      class BrokenBridge extends StrategyBridge {
        constructor(transport: StrategyTransport, options: StrategyBridgeOptions) {
          super(transport, options);
          opened = transport;

          throw failure;
        }
      }

      const closeTransport = TypeScriptTransport.prototype.close;
      const close = vi.spyOn(TypeScriptTransport.prototype, 'close').mockImplementation(function (
        this: TypeScriptTransport,
      ) {
        closeTransport.call(this);
        if (cleanupThrows) {
          throw new Error('cleanup failed');
        }
      });

      try {
        await expect(
          BrokenBridge.create({ language: 'typescript', code: 'export default {};' }),
        ).rejects.toBe(failure);
        expect(close).toHaveBeenCalledOnce();
        expect(opened?.isClosed).toBe(true);
      } finally {
        close.mockRestore();
        opened?.close();
      }
    },
  );
});

describe('shared strategy bridge', () => {
  it('passes startup cancellation through the shared Bridge contract before send and after read', async () => {
    const { session, sent } = transport([ready]);
    const bridge: SandboxBridge<StrategyDecisionInput, void, StrategySandboxMetadata> =
      new StrategyBridge(session, {
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

  it('reports query failures to the sandbox and continues with acknowledged commands', async () => {
    const { session, sent, historyUpdates } = transport([
      ready,
      { type: 'request', id: 9, method: 'bars', arguments: { codes: ['AAA'] } },
      commandRequest(10, { operation: 'stock.closePosition', arguments: { code: 'BBB' } }),
      done,
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

  it.each(['synchronous', 'request'] as const)(
    'executes all supported commands in order through the %s channel',
    async (channel) => {
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
      const { session, sent, historyUpdates } = transport([
        ready,
        ...(channel === 'request'
          ? commands.map((command, index) => commandRequest(index + 1, command))
          : []),
        done,
      ]);
      if (channel === 'synchronous') {
        let hostAccess: ((input: unknown) => unknown) | undefined;
        session.setHostAccess = (handler) => {
          hostAccess = handler;
        };
        const send = session.send.bind(session);
        session.send = async (frame) => {
          if (frame.type === 'bar') {
            expect(hostAccess).toBeTypeOf('function');
            for (const command of commands) {
              expect(hostAccess!({ type: 'command', command })).toEqual({});
            }
          }
          await send(frame);
        };
      }
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
      expect(sent.filter((frame) => frame.type === 'response')).toEqual(
        channel === 'request'
          ? commands.map((_command, index) => ({ type: 'response', id: index + 1, result: {} }))
          : [],
      );
    },
  );

  it('rejects individual malformed commands without mutating them and accepts later commands', async () => {
    const { session, sent } = transport([
      ready,
      commandRequest(1, { operation: 'stock.closePosition', arguments: { code: 'AAA' } }),
      commandRequest(2, {
        operation: 'stock.orderAdjustedShares',
        arguments: { code: 'AAA', shares: 'invalid' },
      }),
      commandRequest(3, { operation: 'shell', arguments: { command: 'id' } }),
      commandRequest(4, { operation: 'stock.closePosition', arguments: { code: 'BBB' } }),
      done,
    ]);
    const strategy = new StrategyBridge(session, {
      startupCommand: { type: 'start' },
      diagnostics,
    });
    await strategy.initialize();

    const { context, spies } = contextFixture();
    await strategy.execute({ context });

    expect(spies.stock.closePosition.mock.calls).toEqual([['AAA'], ['BBB']]);
    expect(spies.stock.orderAdjustedShares).not.toHaveBeenCalled();
    expect(sent.filter((frame) => frame.type === 'response')).toEqual([
      { type: 'response', id: 1, result: {} },
      { type: 'response', id: 2, error: expect.any(String) },
      { type: 'response', id: 3, error: expect.any(String) },
      { type: 'response', id: 4, result: {} },
    ]);
    expect(session.abort).not.toHaveBeenCalled();
  });

  it('returns engine rejection at the command request and lets the callback recover', async () => {
    const { session, sent } = transport([
      ready,
      commandRequest(1, {
        operation: 'stock.setTargetWeight',
        arguments: { code: 'AAA', weight: 1.2 },
      }),
      commandRequest(2, {
        operation: 'stock.setTargetWeight',
        arguments: { code: 'AAA', weight: 0.5 },
      }),
      done,
    ]);
    const strategy = new StrategyBridge(session, {
      startupCommand: { type: 'start' },
      diagnostics,
    });
    await strategy.initialize();

    const { context, spies } = contextFixture();
    spies.stock.setTargetWeight.mockImplementationOnce(() => {
      throw new Error('invalid target weight');
    });
    await strategy.execute({ context });

    expect(spies.stock.setTargetWeight.mock.calls).toEqual([
      ['AAA', 1.2],
      ['AAA', 0.5],
    ]);
    expect(sent.filter((frame) => frame.type === 'response')).toEqual([
      { type: 'response', id: 1, error: 'invalid target weight' },
      { type: 'response', id: 2, result: {} },
    ]);
  });

  it('does not roll back accepted commands when the callback subsequently fails', async () => {
    const { session } = transport([
      ready,
      commandRequest(1, { operation: 'stock.closePosition', arguments: { code: 'AAA' } }),
      { type: 'error', message: 'callback failed after the command' },
    ]);
    const strategy = new StrategyBridge(session, {
      startupCommand: { type: 'start' },
      diagnostics,
    });
    await strategy.initialize();

    const { context, spies } = contextFixture();
    await expect(strategy.execute({ context })).rejects.toThrow(
      'callback failed after the command',
    );
    expect(spies.stock.closePosition).toHaveBeenCalledExactlyOnceWith('AAA');
  });

  it('propagates a failed command acknowledgement without undoing the accepted command', async () => {
    const { session } = transport([
      ready,
      commandRequest(1, { operation: 'stock.closePosition', arguments: { code: 'AAA' } }),
      done,
    ]);
    const send = session.send.bind(session);
    session.send = async (frame) => {
      if (frame.type === 'response') {
        throw new Error('connection lost during acknowledgement');
      }
      await send(frame);
    };
    const strategy = new StrategyBridge(session, {
      startupCommand: { type: 'start' },
      diagnostics,
    });
    await strategy.initialize();

    const { context, spies } = contextFixture();
    await expect(strategy.execute({ context })).rejects.toThrow(
      'connection lost during acknowledgement',
    );
    expect(spies.stock.closePosition).toHaveBeenCalledExactlyOnceWith('AAA');
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
      { ...ready, metadata: { ...metadata, accounts: null } },
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
  const startup = { ...ready, metadata: { ...metadata, watch: [] } };

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
