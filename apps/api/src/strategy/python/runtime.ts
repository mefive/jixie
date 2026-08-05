import { DEFAULT_LOCALE, type Locale, type StrategyParamValue } from '@jixie/shared';
import type { BarContext, BarRow, OhlcBar, Strategy } from '../../engine/types.js';
import { makeSandboxConsole, type UserLogSink } from '../../lib/sandbox-console.js';
import { PythonSession, type PythonFrame } from './session.js';

interface PythonMetadata {
  name: string;
  params: Record<string, StrategyParamValue>;
  factors: string[];
  watch: string[];
  futures: string[];
  accounts?: Strategy['accounts'];
}

interface PythonCommand {
  operation: string;
  arguments: Record<string, unknown>;
}

export interface PythonStrategyRuntime {
  strategy: Strategy;
  close(): Promise<void>;
}

export async function createPythonStrategyRuntime(
  code: string,
  onUserLog?: UserLogSink,
  paramOverrides?: Record<string, StrategyParamValue>,
  locale: Locale = DEFAULT_LOCALE,
): Promise<PythonStrategyRuntime> {
  const session = await PythonSession.connect();
  const sandboxConsole = onUserLog ? makeSandboxConsole(onUserLog, 2_000, locale) : undefined;
  const logSink: UserLogSink | undefined = sandboxConsole
    ? (level, text) => sandboxConsole[level === 'warn' ? 'warn' : level](text)
    : undefined;
  try {
    await session.send({
      type: 'start',
      runtime_version: 'py-v1',
      code,
      param_overrides: paramOverrides ?? {},
    });
    const metadata = await waitForReady(session, logSink);
    const strategy: Strategy = {
      name: metadata.name,
      params: metadata.params,
      factors: metadata.factors,
      watch: metadata.watch,
      futures: metadata.futures,
      accounts: metadata.accounts,
      onBar: (context) => runPythonBar(session, context, metadata.factors, metadata.watch, logSink),
    };
    return {
      strategy,
      async close() {
        await session.send({ type: 'close' }).catch(() => {});
        session.close();
      },
    };
  } catch (error) {
    session.close();
    throw error;
  }
}

async function waitForReady(
  session: PythonSession,
  onUserLog?: UserLogSink,
): Promise<PythonMetadata> {
  while (true) {
    const frame = await session.read();
    if (forwardLog(frame, onUserLog)) {
      continue;
    }
    if (frame.type === 'ready') {
      return frame.metadata as PythonMetadata;
    }
    if (frame.type === 'fatal' || frame.type === 'error') {
      throw new Error(String(frame.message ?? 'Python strategy initialization failed'));
    }
    throw new Error(`unexpected Python sandbox frame while starting: ${frame.type}`);
  }
}

async function runPythonBar(
  session: PythonSession,
  context: BarContext,
  factors: string[],
  watch: string[],
  onUserLog?: UserLogSink,
): Promise<void> {
  await session.send({ type: 'bar', snapshot: contextSnapshot(context, watch) });
  while (true) {
    const frame = await session.read();
    if (forwardLog(frame, onUserLog)) {
      continue;
    }
    if (frame.type === 'request') {
      await answerRequest(session, frame, context, factors);
      continue;
    }
    if (frame.type === 'done') {
      replayCommands(context, frame.commands as PythonCommand[]);
      return;
    }
    if (frame.type === 'error' || frame.type === 'fatal') {
      throw new Error(String(frame.message ?? 'Python strategy failed'));
    }
    throw new Error(`unexpected Python sandbox frame during on_bar: ${frame.type}`);
  }
}

function contextSnapshot(context: BarContext, watch: string[]): Record<string, unknown> {
  const updateCodes = new Set([...watch, ...context.positions().map((position) => position.code)]);
  return {
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
        return row ? [[code, pythonOhlc(row)]] : [];
      }),
    ),
  };
}

async function answerRequest(
  session: PythonSession,
  frame: PythonFrame,
  context: BarContext,
  factors: string[],
): Promise<void> {
  const id = frame.id as number;
  try {
    const arguments_ = frame.arguments as Record<string, unknown>;
    let result: unknown;
    switch (frame.method) {
      case 'cross_section': {
        const indexCode = arguments_.index_code as string | null;
        const codes = await context.loadCrossSection(indexCode ?? undefined);
        result = {
          codes,
          rows: codes.flatMap((code) => {
            const row = context.bar(code);
            return row ? [pythonBarRow(row, context, factors)] : [];
          }),
        };
        break;
      }
      case 'bars': {
        const codes = arguments_.codes as string[];
        await context.ensureBars(codes);
        result = {
          bars: Object.fromEntries(
            codes.map((code) => [
              code,
              context.bars(code, Number.MAX_SAFE_INTEGER).map(pythonOhlc),
            ]),
          ),
        };
        break;
      }
      default:
        throw new Error(`unknown Python context request: ${String(frame.method)}`);
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

function pythonBarRow(
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

function pythonOhlc(row: OhlcBar): Record<string, unknown> {
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

function replayCommands(context: BarContext, commands: PythonCommand[]): void {
  for (const command of commands) {
    const arguments_ = command.arguments;
    switch (command.operation) {
      case 'order_target_percent':
        context.orderTargetPercent(arguments_.code as string, arguments_.weight as number);
        break;
      case 'set_holdings':
        context.setHoldings(arguments_.weights as Record<string, number>);
        break;
      case 'order':
        context.order(arguments_.code as string, arguments_.shares as number);
        break;
      case 'order_lots':
        context.orderLots(arguments_.code as string, arguments_.lots as number);
        break;
      case 'exit':
        context.exit(arguments_.code as string);
        break;
      case 'stop_loss':
        context.stopLoss(arguments_.code as string, arguments_.price as number);
        break;
      case 'trailing_stop':
        context.trailingStop(arguments_.code as string, arguments_.percentage as number);
        break;
      case 'limit_buy':
        context.limitBuy(
          arguments_.code as string,
          arguments_.price as number,
          arguments_.shares as number,
        );
        break;
      case 'take_profit':
        context.takeProfit(arguments_.code as string, arguments_.percentage as number);
        break;
      case 'cancel_conditional':
        context.cancelConditional(
          arguments_.code as string,
          arguments_.kind as Parameters<BarContext['cancelConditional']>[1],
        );
        break;
      default:
        throw new Error(`unknown Python strategy command: ${command.operation}`);
    }
  }
}

function forwardLog(frame: PythonFrame, onUserLog?: UserLogSink): boolean {
  if (frame.type !== 'log') {
    return false;
  }
  onUserLog?.(
    frame.level === 'error' ? 'error' : frame.level === 'warning' ? 'warn' : 'info',
    String(frame.text ?? ''),
  );
  return true;
}
