import type { z } from 'zod';
import { replayCommands } from './commands.js';
import { accessStrategyContext } from './context-access.js';
import { DEFAULT_LOCALE, type Locale } from '@jixie/shared';
import type { BarContext, BarRow, OhlcBar, Strategy } from '#engine/types.js';
import { makeSandboxConsole, type UserLogSink } from '#infra/runtime/console.js';
import {
  strategyExecutionFrameSchema,
  strategyStartupFrameSchema,
  type StrategyRequestFrame,
  type StrategyMetadata,
} from './protocol.js';

/** Transport adapters validate frames and abort their session on protocol violations. */
export interface StrategyTransport {
  readonly historyUpdates?: boolean;
  /** Bind only during onBar; synchronous languages preserve call-site errors and first reads. */
  setContextAccess?(handler: ((input: unknown) => unknown) | undefined): void;
  send(frame: { type: string; [key: string]: unknown }): Promise<void>;
  readValidated<Frame>(schema: z.ZodType<Frame>, operation: string): Promise<Frame>;
}

interface StrategyBridgeDiagnostics {
  language: string;
  callback: string;
}

export interface StrategyBridgeOptions {
  diagnostics: StrategyBridgeDiagnostics;
  onUserLog?: UserLogSink;
  locale?: Locale;
}

/** The caller owns startup and cleanup; this bridge owns the engine-facing strategy. */
export async function createStrategyBridge(
  session: StrategyTransport,
  options: StrategyBridgeOptions,
): Promise<Strategy> {
  const { diagnostics, onUserLog, locale = DEFAULT_LOCALE } = options;
  const sandboxConsole = onUserLog ? makeSandboxConsole(onUserLog, 2_000, locale) : undefined;
  const logSink: UserLogSink | undefined = sandboxConsole
    ? (level, text) => sandboxConsole[level === 'warn' ? 'warn' : level](text)
    : undefined;
  const metadata = await waitForReady(session, diagnostics, logSink);
  const historyDates = session.historyUpdates
    ? new Map<string, string | null>(metadata.watch.map((code) => [code, null]))
    : undefined;
  return {
    name: metadata.name,
    params: metadata.params,
    factors: metadata.factors,
    watch: metadata.watch,
    futures: metadata.futures,
    accounts: metadata.accounts ?? undefined,
    async onBar(context) {
      session.setContextAccess?.((input) => accessStrategyContext(context, input));
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
        session.setContextAccess?.(undefined);
      }
    },
  };
}

async function waitForReady(
  session: StrategyTransport,
  diagnostics: StrategyBridgeDiagnostics,
  onUserLog?: UserLogSink,
): Promise<StrategyMetadata> {
  while (true) {
    const frame = await session.readValidated(
      strategyStartupFrameSchema,
      `starting a ${diagnostics.language} strategy`,
    );
    if (forwardLog(frame, onUserLog)) {
      continue;
    }
    if (frame.type === 'ready') {
      return frame.metadata;
    }
    if (frame.type === 'fatal' || frame.type === 'error') {
      throw new Error(
        String(frame.message ?? `${diagnostics.language} strategy initialization failed`),
      );
    }
    throw new Error(
      `unexpected ${diagnostics.language} sandbox frame while starting: ${frame.type}`,
    );
  }
}

async function runStrategyBar(
  session: StrategyTransport,
  context: BarContext,
  factors: string[],
  watch: string[],
  diagnostics: StrategyBridgeDiagnostics,
  onUserLog?: UserLogSink,
  historyDates?: Map<string, string | null>,
): Promise<void> {
  await session.send({ type: 'bar', snapshot: contextSnapshot(context, watch, historyDates) });
  while (true) {
    const frame = await session.readValidated(
      strategyExecutionFrameSchema,
      `executing a ${diagnostics.language} strategy bar`,
    );
    if (forwardLog(frame, onUserLog)) {
      continue;
    }
    if (frame.type === 'request') {
      await answerRequest(session, frame, context, factors, historyDates);
      continue;
    }
    if (frame.type === 'done') {
      replayCommands(context, frame.commands);
      return;
    }
    if (frame.type === 'error' || frame.type === 'fatal') {
      throw new Error(String(frame.message ?? `${diagnostics.language} strategy failed`));
    }
    throw new Error(
      `unexpected ${diagnostics.language} sandbox frame during ${diagnostics.callback}: ${frame.type}`,
    );
  }
}

function contextSnapshot(
  context: BarContext,
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
  session: StrategyTransport,
  frame: StrategyRequestFrame,
  context: BarContext,
  factors: string[],
  historyDates?: Map<string, string | null>,
): Promise<void> {
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
    await session.send({ type: 'response', id, result });
  } catch (error) {
    await session.send({
      type: 'response',
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function snapshotBarRow(
  row: BarRow,
  context: BarContext,
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

function forwardLog(
  frame: { type: string; level?: unknown; text?: unknown },
  onUserLog?: UserLogSink,
): boolean {
  if (frame.type !== 'log') {
    return false;
  }
  onUserLog?.(
    frame.level === 'error' ? 'error' : frame.level === 'warning' ? 'warn' : 'info',
    String(frame.text ?? ''),
  );
  return true;
}

/** Transfer history once, then only rows since the last callback, including gaps and suspensions. */
function historyUpdates(
  context: BarContext,
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
