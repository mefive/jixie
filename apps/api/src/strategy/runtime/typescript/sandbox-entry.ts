import type { EngineContext, BarRow, IndexHandle, OhlcBar, EngineStrategy } from '#engine/types.js';
import type { Locale, StrategyParamValue } from '@jixie/shared';
import {
  makeSandboxConsole,
  noopSandboxConsole,
  type SandboxConsole,
} from '#infra/runtime/console.js';
import { defineStrategy, applyStrategyParamOverrides } from '../../sdk/typescript.js';

interface HostFunction {
  applySync(receiver: undefined, args: string[]): string;
}
declare const __hostEmit: HostFunction;
declare const __hostAccess: HostFunction;

let strategy: EngineStrategy;
let sequence = 0;
const reads = new Map<string, string>();
const histories = new Map<string, OhlcBar[]>();
interface HistoryUpdate {
  reset: boolean;
  bars: OhlcBar[];
}
function updateHistories(updates: Record<string, HistoryUpdate>): void {
  for (const [code, update] of Object.entries(updates)) {
    if (update.reset) {
      histories.set(code, update.bars);
    } else {
      histories.get(code)!.push(...update.bars);
    }
  }
}
function cachedBars(code: string, count: number): OhlcBar[] | undefined {
  const bars = histories.get(code);
  if (!bars || !Number.isSafeInteger(count) || count < 0) {
    return undefined;
  }
  return bars.slice(Math.max(0, bars.length - count)).map((bar) => ({ ...bar }));
}
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

function query(method: string, args: unknown[]): unknown {
  const key = JSON.stringify({ type: 'read', request: { method, args } });
  let json = reads.get(key);
  if (json == null) {
    json = __hostAccess.applySync(undefined, [key]);
    const reply = JSON.parse(json);
    if ('error' in reply) {
      throw new Error(reply.error);
    }
    reads.set(key, json);
  }
  // Each caller receives its own data copy, never a mutable cached host object.
  return JSON.parse(json).result;
}

function access(input: unknown): unknown {
  const reply = JSON.parse(__hostAccess.applySync(undefined, [JSON.stringify(input)]));
  if ('error' in reply) {
    throw new Error(reply.error);
  }
  return reply.result;
}
function command(operation: string, args: Record<string, unknown>): void {
  access({ type: 'command', command: { operation, arguments: args } });
}
function request(args: Record<string, unknown>): Promise<unknown> {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    __hostEmit.applySync(undefined, [
      JSON.stringify({ type: 'request', id, method: 'context_data', arguments: args }),
    ]);
  });
}

function loadStrategy(userJs: string, sandboxConsole: SandboxConsole): EngineStrategy {
  const module: { exports: Record<string, unknown> } = { exports: {} };
  try {
    const evaluate = new Function(
      'module',
      'exports',
      'defineStrategy',
      'console',
      'require',
      userJs,
    );
    evaluate(module, module.exports, defineStrategy, sandboxConsole, (id: string) => {
      throw new Error(
        `strategy code cannot import external modules (${id}) — all capabilities are on ctx`,
      );
    });
  } catch (error) {
    throw new Error(
      `strategy code execution error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = (module.exports.default ?? module.exports) as Partial<EngineStrategy>;
  if (!result || typeof result.onBar !== 'function') {
    throw new Error('strategy must `export default defineStrategy({ onBar(ctx) { … } })`');
  }
  result.name ||= 'Untitled strategy';
  return result as EngineStrategy;
}

interface Startup {
  userJs: string;
  paramOverrides?: Record<string, StrategyParamValue>;
  locale?: Locale;
  captureUserLogs: boolean;
}

interface StrategyBarSnapshot {
  date: string;
  cash: number;
  value: number;
  available_cash: number;
  stock_value: number;
  future_value: number;
  stock_available_cash: number;
  future_available_cash: number;
  future_margin: number;
  positions: Array<{ code: string; shares: number; avg_cost: number; market_value: number }>;
  history_updates?: Record<string, HistoryUpdate>;
}

type StrategyHostResponse = { id: number } & ({ result: unknown } | { error: string });

function startStrategy(config: Startup) {
  const console = config.captureUserLogs
    ? makeSandboxConsole(
        (level, text) => {
          __hostEmit.applySync(undefined, [
            JSON.stringify({ type: 'log', level: level === 'warn' ? 'warning' : level, text }),
          ]);
        },
        2_000,
        config.locale,
      )
    : noopSandboxConsole;
  strategy = loadStrategy(config.userJs, console);
  applyStrategyParamOverrides(strategy, config.paramOverrides);
  return JSON.stringify({
    type: 'ready',
    metadata: {
      name: strategy.name,
      params: strategy.params ?? {},
      factors: strategy.factors ?? [],
      watch: strategy.watch ?? [],
      futures: strategy.futures ?? [],
      accounts: strategy.accounts ?? null,
    },
  });
}

function receiveResponse(reply: StrategyHostResponse) {
  const waiting = pending.get(reply.id);
  if (!waiting) {
    throw new Error('Unexpected strategy response ID');
  }
  pending.delete(reply.id);
  if ('error' in reply) {
    waiting.reject(new Error(reply.error));
  } else {
    waiting.resolve(reply.result);
  }
}

async function runStrategyBar(snapshot: StrategyBarSnapshot) {
  reads.clear();
  updateHistories(snapshot.history_updates ?? {});
  // Cross-sections are immutable copies; the latest load replaces the visible panel, as in Engine.
  let rows = new Map<string, BarRow | null>();
  const core: EngineContext = {
    date: snapshot.date,
    cash: snapshot.cash,
    value: snapshot.value,
    availableCash: snapshot.available_cash,
    stockValue: snapshot.stock_value,
    futureValue: snapshot.future_value,
    stockAvailableCash: snapshot.stock_available_cash,
    futureAvailableCash: snapshot.future_available_cash,
    futureMargin: snapshot.future_margin,
    positions: () =>
      snapshot.positions.map(
        (position: { code: string; shares: number; avg_cost: number; market_value: number }) => ({
          code: position.code,
          shares: position.shares,
          avgCost: position.avg_cost,
          marketValue: position.market_value,
        }),
      ),
    async loadCrossSection(indexCode) {
      const result = (await request({
        operation: 'cross_section',
        index_code: indexCode ?? null,
      })) as { codes: string[]; rows: Array<[string, BarRow | null]> };
      reads.clear();
      rows = new Map(result.rows);
      return result.codes;
    },
    async ensureBars(codes) {
      const result = (await request({ operation: 'ensure_bars', codes: [...new Set(codes)] })) as {
        history_updates: Record<string, HistoryUpdate>;
      };
      updateHistories(result.history_updates);
      reads.clear();
    },
    async indexMembers(indexCode) {
      return (await request({ operation: 'index_members', index_code: indexCode })) as string[];
    },
    bar: (code) => rows.get(code) ?? null,
    bars: (code, n) =>
      cachedBars(code, n) ?? (query('bars', [code, n]) as ReturnType<EngineContext['bars']>),
    resampledBars: (code, period, n) =>
      query('resampledBars', [code, period, n]) as ReturnType<EngineContext['resampledBars']>,
    listDays: (code) => query('listDays', [code]) as number | null,
    industry: (code) => query('industry', [code]) as string | null,
    lhbNet: (code) => query('lhbNet', [code]) as number | null,
    price: (code) =>
      histories.has(code)
        ? (histories.get(code)!.at(-1)?.adjClose ?? null)
        : (query('price', [code]) as number | null),
    history: (code, field, n) => {
      const bars = cachedBars(code, n);
      const column = {
        open: 'adjOpen',
        high: 'adjHigh',
        low: 'adjLow',
        close: 'adjClose',
      } as const;
      return bars
        ? bars.map((bar) => bar[column[field]])
        : (query('history', [code, field, n]) as number[]);
    },
    factor: (name, code) => query('factor', [name, code]) as number | null,
    shares: (code) => query('shares', [code]) as number,
    future: (code) => query('future', [code]) as ReturnType<EngineContext['future']>,
    futureHistory: (code, field, n) => query('futureHistory', [code, field, n]) as number[],
    futurePosition: (code) =>
      query('futurePosition', [code]) as ReturnType<EngineContext['futurePosition']>,
    index(indexCode) {
      const values = query('indexValues', [indexCode]) as Pick<
        IndexHandle,
        'close' | 'pe' | 'peTtm' | 'pb'
      >;
      return {
        ...values,
        sma: (n) => query('indexSma', [indexCode, n]) as number | null,
        percentile: (field, lookback) =>
          query('indexPercentile', [indexCode, field, lookback ?? null]) as number | null,
      };
    },
    orderTargetPercent: (code, weight) => command('order_target_percent', { code, weight }),
    setHoldings: (weights) =>
      command('set_holdings', {
        weights: weights instanceof Map ? Object.fromEntries(weights) : weights,
      }),
    order: (code, shares) => command('order', { code, shares }),
    orderLots: (code, lots) => command('order_lots', { code, lots }),
    exit: (code) => command('exit', { code }),
    stopLoss: (code, price) => command('stop_loss', { code, price }),
    trailingStop: (code, percentage) => command('trailing_stop', { code, percentage }),
    limitBuy: (code, price, shares) => command('limit_buy', { code, price, shares }),
    takeProfit: (code, percentage) => command('take_profit', { code, percentage }),
    cancelConditional: (code, kind) => command('cancel_conditional', { code, kind: kind ?? null }),
    orderFuture: (code, contracts) => command('order_future', { code, contracts }),
    setFutureTargetContracts: (code, contracts) =>
      command('set_future_target_contracts', { code, contracts }),
    setFutureTargetNotional: (code, notional) =>
      command('set_future_target_notional', { code, notional }),
    hedgeFuture: (code, beta = 1) => command('hedge_future', { code, beta }),
    exitFuture: (code) => command('exit_future', { code }),
  };
  await strategy.onBar(core);
  return JSON.stringify({ type: 'done', commands: [] });
}

(globalThis as Record<string, unknown>).__receiveCommand = (json: string) => {
  const frame = JSON.parse(json);
  switch (frame.type) {
    case 'start':
      return startStrategy(frame);
    case 'bar':
      return runStrategyBar(frame.snapshot);
    case 'response':
      return receiveResponse(frame);
    default:
      throw new Error(`Unsupported strategy command: ${frame.type}`);
  }
};
