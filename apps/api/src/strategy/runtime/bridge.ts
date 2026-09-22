import {
  exchangeSandboxCommand,
  type SandboxFrame,
  type SandboxTransport,
} from '#infra/runtime/exchange.js';
import type { StrategyRuntimeMetadata } from './contract.js';
import { replayCommands } from './commands.js';
import { accessStrategyContext } from './context-access.js';
import { DEFAULT_LOCALE, type Locale } from '@jixie/shared';
import type { EngineContext, BarRow, OhlcBar } from '#engine/types.js';
import { makeSandboxConsole, type UserLogSink } from '#infra/runtime/console.js';
import {
  strategyExecutionFrameSchema,
  strategyStartupFrameSchema,
  type StrategyRequestFrame,
} from './protocol.js';

/** Transport adapters validate frames and abort their session on protocol violations. */
export interface StrategyTransport extends SandboxTransport {
  /** Bind only during onBar; synchronous languages preserve call-site errors and first reads. */
  setHostAccess?(handler: ((input: unknown) => unknown) | undefined): void;
}

interface StrategyBridgeDiagnostics {
  language: string;
  callback: string;
}

export interface StrategyBridgeOptions {
  startupCommand: SandboxFrame;
  historyUpdates?: boolean;
  diagnostics: StrategyBridgeDiagnostics;
  onUserLog?: UserLogSink;
  locale?: Locale;
}

export interface StrategyBridge {
  metadata: StrategyRuntimeMetadata;
  execute(context: EngineContext): Promise<void>;
}

/** Share protocol state across callbacks; the owner adapts execute to the engine once. */
export async function createStrategyBridge(
  session: StrategyTransport,
  options: StrategyBridgeOptions,
): Promise<StrategyBridge> {
  const { diagnostics, onUserLog, locale = DEFAULT_LOCALE } = options;
  const sandboxConsole = onUserLog ? makeSandboxConsole(onUserLog, 2_000, locale) : undefined;
  const logSink: UserLogSink | undefined = sandboxConsole
    ? (level, text) => sandboxConsole[level === 'warn' ? 'warn' : level](text)
    : undefined;
  const metadata = await exchangeSandboxCommand(session, {
    command: options.startupCommand,
    schema: strategyStartupFrameSchema,
    operation: `starting a ${diagnostics.language} strategy`,
    onLog: (frame) => logSink?.(frame.level === 'warning' ? 'warn' : frame.level, frame.text),
    result: (frame) => frame.metadata,
  });
  const historyDates = options.historyUpdates
    ? new Map<string, string | null>(metadata.watch.map((code) => [code, null]))
    : undefined;
  return {
    metadata: {
      name: metadata.name,
      params: metadata.params,
      factors: metadata.factors,
      watch: metadata.watch,
      futures: metadata.futures,
      accounts: metadata.accounts ?? undefined,
    },
    async execute(context) {
      session.setHostAccess?.((input) => accessStrategyContext(context, input));
      try {
        await runStrategyBar(
          session,
          context,
          metadata.factors,
          metadata.watch,
          diagnostics,
          logSink,
          historyDates,
        );
      } finally {
        session.setHostAccess?.(undefined);
      }
    },
  };
}

async function runStrategyBar(
  session: StrategyTransport,
  context: EngineContext,
  factors: string[],
  watch: string[],
  diagnostics: StrategyBridgeDiagnostics,
  onUserLog?: UserLogSink,
  historyDates?: Map<string, string | null>,
): Promise<void> {
  const commands = await exchangeSandboxCommand(session, {
    command: { type: 'bar', snapshot: contextSnapshot(context, watch, historyDates) },
    schema: strategyExecutionFrameSchema,
    operation: `executing a ${diagnostics.language} strategy ${diagnostics.callback}`,
    onLog: (frame) => onUserLog?.(frame.level === 'warning' ? 'warn' : frame.level, frame.text),
    onRequest: (frame) => answerRequest(frame, context, factors, historyDates),
    result: (frame) => frame.commands,
  });
  replayCommands(context, commands);
}

function contextSnapshot(
  context: EngineContext,
  watch: string[],
  historyDates?: Map<string, string | null>,
): Record<string, unknown> {
  const updateCodes = new Set([...watch, ...context.positions().map((position) => position.code)]);
  if (historyDates) {
    for (const code of updateCodes) {
      if (!historyDates.has(code)) {
        historyDates.set(code, null);
      }
    }
  }
  return {
    ...(historyDates ? { history_updates: historyUpdates(context, historyDates) } : {}),
    date: context.date,
    cash: context.cash,
    value: context.value,
    available_cash: context.availableCash,
    stock_value: context.stockValue,
    future_value: context.futureValue,
    stock_available_cash: context.stockAvailableCash,
    future_available_cash: context.futureAvailableCash,
    future_margin: context.futureMargin,
    positions: context.positions().map((position) => ({
      code: position.code,
      shares: position.shares,
      avg_cost: position.avgCost,
      market_value: position.marketValue,
    })),
    bar_updates: Object.fromEntries(
      [...updateCodes].flatMap((code) => {
        const row = context.bars(code, 1)[0];
        return row ? [[code, snapshotOhlc(row)]] : [];
      }),
    ),
  };
}

async function answerRequest(
  frame: StrategyRequestFrame,
  context: EngineContext,
  factors: string[],
  historyDates?: Map<string, string | null>,
): Promise<SandboxFrame> {
  const id = frame.id;
  try {
    let result: unknown;
    switch (frame.method) {
      case 'context_data': {
        switch (frame.arguments.operation) {
          case 'cross_section': {
            const codes = await context.loadCrossSection(frame.arguments.index_code ?? undefined);
            result = { codes, rows: codes.map((code) => [code, context.bar(code)]) };
            break;
          }
          case 'ensure_bars':
            await context.ensureBars(frame.arguments.codes);
            if (historyDates) {
              const requested = new Map<string, string | null>(
                frame.arguments.codes.map((code) => [code, historyDates.get(code) ?? null]),
              );
              result = { history_updates: historyUpdates(context, requested) };
              for (const code of requested.keys()) {
                historyDates.set(code, context.date);
              }
            } else {
              result = null;
            }
            break;
          case 'index_members':
            result = await context.indexMembers(frame.arguments.index_code);
            break;
        }
        break;
      }
      case 'cross_section': {
        const indexCode = frame.arguments.index_code;
        const codes = await context.loadCrossSection(indexCode ?? undefined);
        result = {
          codes,
          rows: codes.flatMap((code) => {
            const row = context.bar(code);
            return row ? [snapshotBarRow(row, context, factors)] : [];
          }),
        };
        break;
      }
      case 'bars': {
        const codes = frame.arguments.codes;
        await context.ensureBars(codes);
        result = {
          bars: Object.fromEntries(
            codes.map((code) => [
              code,
              context.bars(code, Number.MAX_SAFE_INTEGER).map(snapshotOhlc),
            ]),
          ),
        };
        break;
      }
    }
    return { type: 'response', id, result };
  } catch (error) {
    return {
      type: 'response',
      id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function snapshotBarRow(
  row: BarRow,
  context: EngineContext,
  factors: string[],
): Record<string, unknown> {
  return {
    code: row.code,
    name: row.name,
    risk_warning: row.riskWarning,
    pending_delisting: row.pendingDelisting,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    adj_open: row.adjOpen,
    adj_high: row.adjHigh,
    adj_low: row.adjLow,
    adj_close: row.adjClose,
    vol: row.vol,
    amount: row.amount,
    pe: row.pe,
    pe_ttm: row.peTtm,
    pb: row.pb,
    ps: row.ps,
    ps_ttm: row.psTtm,
    dv_ratio: row.dvRatio,
    dv_ttm: row.dvTtm,
    total_mv: row.totalMv,
    circ_mv: row.circMv,
    turnover_rate: row.turnoverRate,
    roe: row.roe,
    roe_waa: row.roeWaa,
    grossprofit_margin: row.grossprofitMargin,
    debt_to_assets: row.debtToAssets,
    list_days: context.listDays(row.code),
    industry: context.industry(row.code),
    lhb_net: context.lhbNet(row.code),
    factors: Object.fromEntries(
      factors.map((factor) => [factor, context.factor(factor, row.code)]),
    ),
  };
}

function snapshotOhlc(row: OhlcBar): Record<string, unknown> {
  return {
    date: row.date,
    adj_open: row.adjOpen,
    adj_high: row.adjHigh,
    adj_low: row.adjLow,
    adj_close: row.adjClose,
    vol: row.vol,
    amount: row.amount,
    turnover_rate_f: row.turnoverRateF,
  };
}

/** Transfer history once, then only rows since the last callback, including gaps and suspensions. */
function historyUpdates(
  context: EngineContext,
  dates: Map<string, string | null>,
): Record<string, { reset: boolean; bars: OhlcBar[] }> {
  const updates: Record<string, { reset: boolean; bars: OhlcBar[] }> = {};
  const timestamp = (date: string) =>
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)));
  for (const [code, previous] of dates) {
    if (previous === context.date) {
      continue;
    }
    // Daily series contain at most one row per calendar day; this also covers skipped callbacks.
    const count =
      previous == null
        ? Number.MAX_SAFE_INTEGER
        : Math.max(1, Math.ceil((timestamp(context.date) - timestamp(previous)) / 86_400_000) + 1);
    const bars = context.bars(code, count).filter((bar) => previous == null || bar.date > previous);
    if (previous == null || bars.length) {
      updates[code] = { reset: previous == null, bars };
    }
    dates.set(code, context.date);
  }
  return updates;
}
