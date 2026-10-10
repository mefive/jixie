import {
  exchangeSandboxCommand,
  type SandboxFrame,
  type SandboxTransport,
} from '#infra/runtime/exchange.js';
import type { RuntimeLogFrame } from '#infra/runtime/protocol.js';
import type { SandboxBridgeInitializationOptions } from '#infra/runtime/sandbox-bridge.js';
import type {
  StrategyBridgeContract,
  StrategyExecutionInput,
  StrategyRuntimeMetadata,
} from './contract.js';
import { replayCommands } from './commands.js';
import { accessStrategyContext } from './context-access.js';
import { DEFAULT_LOCALE, type Locale } from '@jixie/shared';
import type { EngineContext } from '#backtesting/contract.js';
import type { BarRow, OhlcBar } from '#backtesting/data/market.js';
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

/** Owns strategy protocol state across callbacks; the runtime owns resource shutdown. */
export class StrategyBridge implements StrategyBridgeContract {
  private factors!: string[];
  private watch!: string[];
  private historyDates?: Map<string, string | null>;
  private readonly sandboxConsole?: ReturnType<typeof makeSandboxConsole>;

  constructor(
    private readonly transport: StrategyTransport,
    private readonly options: StrategyBridgeOptions,
  ) {
    const { onUserLog, locale = DEFAULT_LOCALE } = options;
    this.sandboxConsole = onUserLog ? makeSandboxConsole(onUserLog, 2_000, locale) : undefined;
  }

  async initialize({
    signal,
  }: SandboxBridgeInitializationOptions = {}): Promise<StrategyRuntimeMetadata> {
    const metadata = await exchangeSandboxCommand(this.transport, {
      command: this.options.startupCommand,
      schema: strategyStartupFrameSchema,
      signal,
      operation: `starting a ${this.options.diagnostics.language} strategy`,
      onLog: (frame) => this.forwardLog(frame),
      result: (frame) => frame.metadata,
    });
    this.factors = metadata.factors;
    this.watch = metadata.watch;
    this.historyDates = this.options.historyUpdates
      ? new Map<string, string | null>(metadata.watch.map((code) => [code, null]))
      : undefined;

    return {
      name: metadata.name,
      params: metadata.params,
      factors: metadata.factors,
      watch: metadata.watch,
      futures: [],
      accounts: metadata.accounts ?? undefined,
    };
  }

  async execute({ context }: StrategyExecutionInput): Promise<void> {
    this.transport.setHostAccess?.((input) => accessStrategyContext(context, input));
    try {
      const commands = await exchangeSandboxCommand(this.transport, {
        command: { type: 'bar', snapshot: this.contextSnapshot(context) },
        schema: strategyExecutionFrameSchema,
        operation: `executing a ${this.options.diagnostics.language} strategy ${this.options.diagnostics.callback}`,
        onLog: (frame) => this.forwardLog(frame),
        onRequest: (frame) => this.answerRequest(frame, context),
        result: (frame) => frame.commands,
      });

      replayCommands(context, commands);
    } finally {
      this.transport.setHostAccess?.(undefined);
    }
  }

  private forwardLog(frame: RuntimeLogFrame): void {
    this.sandboxConsole?.[frame.level === 'warning' ? 'warn' : frame.level](frame.text);
  }

  private contextSnapshot(context: EngineContext): Record<string, unknown> {
    const watch = this.watch;
    const historyDates = this.historyDates;
    const updateCodes = new Set([
      ...watch,
      ...context.stock.positions().map((position) => position.code),
    ]);
    if (historyDates) {
      for (const code of updateCodes) {
        if (!historyDates.has(code)) {
          historyDates.set(code, null);
        }
      }
    }

    return {
      ...(historyDates ? { history_updates: this.historyUpdates(context, historyDates) } : {}),
      date: context.date,
      portfolio: { equity: context.portfolio.equity },
      stock: {
        equity: context.stock.equity,
        availableCash: context.stock.availableCash,
        positions: context.stock.positions(),
      },
      futures: {
        equity: context.futures.equity,
        availableCash: context.futures.availableCash,
        margin: context.futures.margin,
      },
      bar_updates: Object.fromEntries(
        [...updateCodes].flatMap((code) => {
          const row = context.bars(code, 1)[0];
          return row ? [[code, snapshotOhlc(row)]] : [];
        }),
      ),
    };
  }

  private async answerRequest(
    frame: StrategyRequestFrame,
    context: EngineContext,
  ): Promise<SandboxFrame> {
    const factors = this.factors;
    const historyDates = this.historyDates;
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
                result = { history_updates: this.historyUpdates(context, requested) };
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

  /** Transfer history once, then only rows since the last callback, including gaps and suspensions. */
  private historyUpdates(
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
          : Math.max(
              1,
              Math.ceil((timestamp(context.date) - timestamp(previous)) / 86_400_000) + 1,
            );
      const bars = context
        .bars(code, count)
        .filter((bar) => previous == null || bar.date > previous);
      if (previous == null || bars.length) {
        updates[code] = { reset: previous == null, bars };
      }
      dates.set(code, context.date);
    }

    return updates;
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
