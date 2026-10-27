import { SandboxBridgeBase } from '#infra/sandbox/sandbox-bridge-base.js';
import { TypeScriptTransport } from '#infra/sandbox/typescript/typescript-transport.js';
import { PythonSession } from '#infra/sandbox/python/python-session.js';
import { toCommonJs } from '#infra/sandbox/typescript/compile.js';
import type { SandboxFrame, SandboxTransport } from '#infra/sandbox/transport.js';
import type { RuntimeLogFrame } from '#infra/sandbox/protocol.js';
import type { SandboxBridgeInitializationOptions } from '#infra/sandbox/sandbox-bridge.js';
import type {
  StrategyStartOptions,
  StrategyDecisionInput,
  StrategySandboxMetadata,
} from './contract.js';
import { readStrategyContext, strategyContextAccessSchema } from './context-access.js';
import { buildStrategySandboxBundle } from './typescript/sandbox-bundle.js';
import { DEFAULT_LOCALE, type Locale } from '@jixie/shared';
import type { EngineContext } from '#backtesting/contract.js';
import type { BarRow, OhlcBar } from '#backtesting/data/market.js';
import { makeSandboxConsole, type UserLogSink } from '#infra/sandbox/console.js';
import {
  strategyDecisionFrameSchema,
  strategyCommandSchema,
  strategyStartupFrameSchema,
  type StrategyRequestFrame,
} from './protocol.js';

/**
 * 约束会校验输出帧并在协议违规时终止会话的策略传输。
 *
 * Transport adapters validate frames and abort their session on protocol violations.
 */
export interface StrategyTransport extends SandboxTransport {
  /** Bind only during onBar; synchronous languages preserve call-site errors and first reads. */
  setHostAccess?(handler: ((input: unknown) => unknown) | undefined): void;
}

/**
 * 保存策略 Bridge 的运行诊断，供调用方排查通信与执行问题。
 *
 * Collect strategy bridge diagnostics for transport and execution troubleshooting.
 */
interface StrategyBridgeDiagnostics {
  language: string;
  callback: string;
}

/**
 * 配置策略 Bridge 的传输、启动输入和稳定宿主能力。
 *
 * Configure the strategy bridge transport, startup input and stable host capabilities.
 */
export interface StrategyBridgeOptions {
  startupCommand: SandboxFrame;
  historyUpdates?: boolean;
  diagnostics: StrategyBridgeDiagnostics;
  onUserLog?: UserLogSink;
  locale?: Locale;
}

/** Owns the strategy protocol connection and state across callbacks. */
export class StrategyBridge extends SandboxBridgeBase<
  StrategyDecisionInput,
  void,
  StrategySandboxMetadata,
  undefined,
  StrategyTransport
> {
  private static bundlePromise?: Promise<string>;

  private factors!: string[];
  private watch!: string[];
  private historyDates?: Map<string, string | null>;
  private readonly sandboxConsole?: ReturnType<typeof makeSandboxConsole>;

  constructor(
    transport: StrategyTransport,
    private readonly options: StrategyBridgeOptions,
  ) {
    super(transport);

    const { onUserLog, locale = DEFAULT_LOCALE } = options;
    this.sandboxConsole = onUserLog ? makeSandboxConsole(onUserLog, 2_000, locale) : undefined;
  }

  static create(options: StrategyStartOptions): Promise<StrategyBridge> {
    switch (options.language) {
      case 'python':
        return this.createPython(options);
      case 'typescript':
        return this.createTypeScript(options);
    }
  }

  /**
   * 准备 Python 启动参数并取得传输，构造失败时回收底层资源。
   *
   * Prepare Python startup and acquire its transport, cleaning up on construction failure.
   */
  private static async createPython({
    code,
    onUserLog,
    paramOverrides,
    locale,
  }: StrategyStartOptions): Promise<StrategyBridge> {
    const transport = await PythonSession.connect();

    try {
      return new this(transport, {
        startupCommand: {
          type: 'start',
          runtime_version: 'py-v1',
          code,
          param_overrides: paramOverrides ?? {},
        },
        diagnostics: { language: 'Python', callback: 'on_bar' },
        onUserLog,
        locale,
      });
    } catch (error) {
      try {
        transport.close();
      } catch {
        // Cleanup must preserve the bridge construction failure.
      }
      throw error;
    }
  }

  /**
   * 编译打包 TypeScript 策略并取得 isolate 传输，供 Bridge 管理会话。
   *
   * Compile and bundle the TypeScript strategy and acquire its isolate transport.
   */
  private static async createTypeScript({
    code,
    onUserLog,
    paramOverrides,
    locale = DEFAULT_LOCALE,
  }: StrategyStartOptions): Promise<StrategyBridge> {
    const userJs = await toCommonJs(code, 'strategy code');
    StrategyBridge.bundlePromise ??= buildStrategySandboxBundle().then(
      (bundle) => bundle.outputFiles[0].text,
    );

    const bundle = await StrategyBridge.bundlePromise;
    const deadline = Date.now() + 3_600_000;
    const transport = await TypeScriptTransport.connect({
      bundle,
      description: 'strategy code',
      memoryMb: 1024,
      allowHostAccess: true,
      commandTimeoutMs: (frame) =>
        frame.type === 'start' ? 5_000 : Math.max(1, deadline - Date.now()),
    });

    try {
      return new this(transport, {
        startupCommand: {
          type: 'start',
          userJs,
          paramOverrides,
          locale,
          captureUserLogs: onUserLog != null,
        },
        historyUpdates: true,
        diagnostics: { language: 'TypeScript', callback: 'onBar' },
        onUserLog,
        locale,
      });
    } catch (error) {
      try {
        transport.close();
      } catch {
        // Cleanup must preserve the bridge construction failure.
      }
      throw error;
    }
  }

  /**
   * 完成策略协议握手并验证同步命令模式，成功后发布元数据。
   *
   * Complete the strategy handshake and verify synchronous command mode before exposing metadata.
   */
  async initialize({
    signal,
  }: SandboxBridgeInitializationOptions = {}): Promise<StrategySandboxMetadata> {
    const metadata = await this.exchange({
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
    };
  }

  async execute({ context }: StrategyDecisionInput): Promise<void> {
    this.transport.setHostAccess?.((input) => this.accessContext(context, input));
    try {
      await this.exchange({
        command: { type: 'bar', snapshot: this.contextSnapshot(context) },
        schema: strategyDecisionFrameSchema,
        operation: `executing a ${this.options.diagnostics.language} strategy ${this.options.diagnostics.callback}`,
        onLog: (frame) => this.forwardLog(frame),
        onRequest: (frame) => this.answerRequest(frame, context),
        result: () => undefined,
      });
    } finally {
      this.transport.setHostAccess?.(undefined);
    }
  }

  private accessContext(context: EngineContext, input: unknown): unknown {
    const access = strategyContextAccessSchema.parse(input);
    if (access.type === 'read') {
      return readStrategyContext(context, access.request);
    }

    this.executeCommand(context, access.command);

    return {};
  }

  /**
   * 校验并同步执行作者账户命令，将宿主确认或错误返回当前调用。
   *
   * Validate and synchronously execute an author account command, returning host acknowledgement or failure.
   */
  private executeCommand(context: EngineContext, input: unknown): void {
    const command = strategyCommandSchema.parse(input);

    switch (command.operation) {
      case 'stock.setTargetWeight':
        context.stock.setTargetWeight(command.arguments.code, command.arguments.weight);
        break;
      case 'stock.setTargetWeights':
        context.stock.setTargetWeights(command.arguments.weights);
        break;
      case 'stock.orderAdjustedShares':
        context.stock.orderAdjustedShares(command.arguments.code, command.arguments.shares);
        break;
      case 'stock.orderLots':
        context.stock.orderLots(command.arguments.code, command.arguments.lots);
        break;
      case 'stock.closePosition':
        context.stock.closePosition(command.arguments.code);
        break;
      case 'stock.stopLossAtAdjustedPrice':
        context.stock.stopLossAtAdjustedPrice(command.arguments.code, command.arguments.price);
        break;
      case 'stock.trailingStopByFraction':
        context.stock.trailingStopByFraction(command.arguments.code, command.arguments.percentage);
        break;
      case 'stock.limitBuyAtAdjustedPrice':
        context.stock.limitBuyAtAdjustedPrice(
          command.arguments.code,
          command.arguments.price,
          command.arguments.shares,
        );
        break;
      case 'stock.takeProfitByFraction':
        context.stock.takeProfitByFraction(command.arguments.code, command.arguments.percentage);
        break;
      case 'stock.cancelConditional':
        context.stock.cancelConditional(
          command.arguments.code,
          command.arguments.kind ?? undefined,
        );
        break;
      default: {
        const unsupportedCommand: never = command;
        throw new Error(`Unsupported strategy command: ${JSON.stringify(unsupportedCommand)}`);
      }
    }
  }

  private forwardLog(frame: RuntimeLogFrame): void {
    this.sandboxConsole?.[frame.level === 'warning' ? 'warn' : frame.level](frame.text);
  }

  /**
   * 构造当前决策的可传输账户及行情快照，供策略适配层读取。
   *
   * Build the serializable account and market snapshot for the current strategy decision.
   */
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
      bar_updates: Object.fromEntries(
        [...updateCodes].flatMap((code) => {
          const row = context.bars(code, 1)[0];
          return row ? [[code, snapshotOhlc(row)]] : [];
        }),
      ),
    };
  }

  /**
   * 按请求种类分派受限宿主读取，向策略运行时返回协议响应。
   *
   * Dispatch supported host-read requests and reply through the strategy protocol.
   */
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
        case 'command':
          this.executeCommand(context, frame.arguments);
          result = {};
          break;
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

  /**
   * 首次传输完整历史，后续只发送新行，同时保留缺口与停牌信息。
   *
   * Transfer history once, then only rows since the last callback, including gaps and suspensions.
   */
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

/**
 * 将引擎行情行转换为策略沙盒快照字段，保持价格口径。
 *
 * Map an engine bar into the strategy sandbox snapshot without changing price conventions.
 */
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
