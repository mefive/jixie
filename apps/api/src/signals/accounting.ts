import { ulid } from 'ulid';
import type {
  ActualExecutionUpdate,
  BacktestConfig,
  ModelPositionSnapshot,
  SignalExecution,
  SignalItem,
  StrategyAccountPoint,
  StrategyExecutionOverview,
} from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { DEFAULT_COST, type CostModel } from '../engine/types.js';
import { prisma } from '../lib/prisma.js';

type AccountKind = 'simulation' | 'actual';
type CashAssetType = 'stock' | 'etf';

interface AccountPosition {
  code: string;
  name: string;
  assetType: CashAssetType;
  shares: number;
  avgCost: number;
  markPrice: number;
  sellableFrom: string;
}

interface AccountState {
  cash: number;
  positions: AccountPosition[];
}

interface MarketQuote {
  open: number | null;
  close: number | null;
  amount: number | null;
  upLimit: number | null;
  downLimit: number | null;
}

interface ReplayOrder {
  id: string;
  code: string;
  name: string;
  assetType: CashAssetType;
  action: 'buy' | 'sell';
  requestedShares: number;
  actualStatus: string;
  actualShares: number | null;
  actualPrice: number | null;
  actualFee: number | null;
}

interface SimulationUpdate {
  id: string;
  status: 'filled' | 'blocked';
  shares: number | null;
  price: number | null;
  fee: number | null;
  slippage: number | null;
  reason: string | null;
}

const MAX_SLIPPAGE = 0.1;

/** Create queryable execution rows and the two account baselines after a signal run finishes. */
export async function initializeSignalAccounting(runId: string): Promise<void> {
  const run = await prisma.signalRun.findUnique({
    where: { id: runId },
    include: {
      deployment: { select: { id: true } },
      executions: { select: { id: true }, take: 1 },
    },
  });
  if (
    !run ||
    run.status !== 'done' ||
    run.modelEquity == null ||
    run.modelCash == null ||
    !Array.isArray(run.signals) ||
    !Array.isArray(run.modelPositions)
  ) {
    return;
  }

  const signals = run.signals as unknown as SignalItem[];
  const positions = run.modelPositions as unknown as ModelPositionSnapshot[];
  await prisma.$transaction(async (transaction) => {
    if (run.executions.length === 0 && signals.length > 0) {
      await transaction.signalExecution.createMany({
        data: signals.map((signal, signalIndex) => ({
          id: ulid(),
          userId: run.userId,
          signalRunId: run.id,
          signalIndex,
          code: signal.code,
          name: signal.name,
          assetType: signal.assetType,
          action: signal.action,
          requestedShares: signal.shares,
          refPrice: signal.refPrice,
          refAmount: signal.refAmount,
          source: signal.source,
          targetWeight: signal.targetWeight,
        })),
      });
    }

    const baseline = await transaction.strategyAccountSnapshot.findFirst({
      where: { deploymentId: run.deploymentId, isBaseline: true },
      select: { id: true },
    });
    if (!baseline) {
      const positionRows = positions.map((position) => ({
        ...position,
        avgCost: position.markPrice,
      }));
      const marketValue = Math.max(0, run.modelEquity! - run.modelCash!);
      await transaction.strategyAccountSnapshot.createMany({
        data: (['simulation', 'actual'] as const).map((kind) => ({
          id: ulid(),
          userId: run.userId,
          deploymentId: run.deploymentId,
          kind,
          tradeDate: run.tradeDate,
          cash: run.modelCash!,
          marketValue,
          equity: run.modelEquity!,
          positions: positionRows as unknown as Prisma.InputJsonValue,
          isBaseline: true,
          sourceRunId: run.id,
        })),
      });
    }
  });
}

/** Settle every account whose execution date is now covered by published market data. */
export async function settleStrategyAccounts(
  throughDate: string,
  onLog: (line: string) => void = console.log,
): Promise<{ deployments: number }> {
  const runs = await prisma.signalRun.findMany({
    where: { status: 'done', execDate: { lte: throughDate } },
    distinct: ['deploymentId'],
    select: { deploymentId: true },
  });
  for (const run of runs) {
    await rebuildDeploymentAccount(run.deploymentId, 'simulation', throughDate, false);
    await rebuildDeploymentAccount(run.deploymentId, 'actual', throughDate, false);
  }
  if (runs.length > 0) {
    onLog(`Settled ${runs.length} strategy account(s) through ${throughDate}`);
  }
  return { deployments: runs.length };
}

export async function updateActualExecution(
  userId: string,
  executionId: string,
  input: ActualExecutionUpdate,
): Promise<{ kind: 'ready'; runId: string } | { kind: 'not_found' } | { kind: 'not_executable' }> {
  const execution = await prisma.signalExecution.findFirst({
    where: { id: executionId, userId },
    include: {
      signalRun: {
        select: { deploymentId: true, execDate: true, status: true },
      },
    },
  });
  if (!execution) {
    return { kind: 'not_found' };
  }
  if (execution.signalRun.status !== 'done') {
    return { kind: 'not_executable' };
  }
  if (input.status !== 'pending' && execution.simulatedStatus === 'pending') {
    return { kind: 'not_executable' };
  }
  if (input.status === 'filled' && input.shares > execution.requestedShares) {
    return { kind: 'not_executable' };
  }

  const now = new Date();
  const data =
    input.status === 'filled'
      ? {
          actualStatus: input.status,
          actualShares: input.shares,
          actualPrice: input.price,
          actualFee: input.fee ?? null,
          actualReason: input.reason ?? null,
          actualNote: input.note ?? null,
          actualRecordedAt: now,
        }
      : input.status === 'skipped'
        ? {
            actualStatus: input.status,
            actualShares: null,
            actualPrice: null,
            actualFee: null,
            actualReason: input.reason,
            actualNote: input.note ?? null,
            actualRecordedAt: now,
          }
        : {
            actualStatus: input.status,
            actualShares: null,
            actualPrice: null,
            actualFee: null,
            actualReason: null,
            actualNote: null,
            actualRecordedAt: null,
          };
  await prisma.signalExecution.update({ where: { id: execution.id }, data });

  const latestSimulation = await prisma.strategyAccountSnapshot.findFirst({
    where: {
      deploymentId: execution.signalRun.deploymentId,
      kind: 'simulation',
    },
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
  });
  if (latestSimulation) {
    await rebuildDeploymentAccount(
      execution.signalRun.deploymentId,
      'actual',
      latestSimulation.tradeDate,
      true,
    );
  }
  return { kind: 'ready', runId: execution.signalRunId };
}

export async function getStrategyExecutionOverview(
  userId: string,
  deploymentId: string,
): Promise<StrategyExecutionOverview | null> {
  const deployment = await prisma.strategyDeployment.findFirst({
    where: { id: deploymentId, userId },
    select: { id: true },
  });
  if (!deployment) {
    return null;
  }

  const [runs, snapshots, executions] = await Promise.all([
    prisma.signalRun.findMany({
      where: { deploymentId, status: 'done', modelEquity: { not: null } },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true, modelEquity: true },
    }),
    prisma.strategyAccountSnapshot.findMany({
      where: { deploymentId },
      orderBy: [{ tradeDate: 'asc' }, { kind: 'asc' }],
    }),
    prisma.signalExecution.findMany({
      where: { signalRun: { deploymentId } },
      select: {
        action: true,
        simulatedStatus: true,
        simulatedPrice: true,
        actualStatus: true,
        actualPrice: true,
      },
    }),
  ]);
  const filled = executions.filter((execution) => execution.actualStatus === 'filled');
  const skipped = executions.filter((execution) => execution.actualStatus === 'skipped');
  const decided = filled.length + skipped.length;
  const deviations = filled.flatMap((execution) => {
    if (
      execution.simulatedStatus !== 'filled' ||
      execution.simulatedPrice == null ||
      execution.actualPrice == null ||
      execution.simulatedPrice <= 0
    ) {
      return [];
    }
    const direction = execution.action === 'buy' ? 1 : -1;
    return [
      direction *
        ((execution.actualPrice - execution.simulatedPrice) / execution.simulatedPrice) *
        10_000,
    ];
  });

  return {
    model: runs.map((run) => ({ date: run.tradeDate, equity: run.modelEquity! })),
    simulation: snapshotPoints(snapshots, 'simulation'),
    actual: snapshotPoints(snapshots, 'actual'),
    execution: {
      total: executions.length,
      filled: filled.length,
      skipped: skipped.length,
      pending: executions.length - decided,
      executionRate: decided > 0 ? filled.length / decided : null,
      averagePriceDeviationBps:
        deviations.length > 0
          ? deviations.reduce((sum, deviation) => sum + deviation, 0) / deviations.length
          : null,
    },
  };
}

export function executionWire(row: {
  id: string;
  signalRunId: string;
  signalIndex: number;
  code: string;
  name: string;
  assetType: string;
  action: string;
  requestedShares: number;
  refPrice: number;
  refAmount: number;
  source: string;
  targetWeight: number | null;
  simulatedStatus: string;
  simulatedShares: number | null;
  simulatedPrice: number | null;
  simulatedFee: number | null;
  simulatedSlippage: number | null;
  simulatedReason: string | null;
  actualStatus: string;
  actualShares: number | null;
  actualPrice: number | null;
  actualFee: number | null;
  actualReason: string | null;
  actualNote: string | null;
  actualRecordedAt: Date | null;
}): SignalExecution {
  return {
    id: row.id,
    signalRunId: row.signalRunId,
    signalIndex: row.signalIndex,
    signal: {
      code: row.code,
      name: row.name,
      assetType: row.assetType === 'etf' ? 'etf' : 'stock',
      action: row.action === 'sell' ? 'sell' : 'buy',
      shares: row.requestedShares,
      refPrice: row.refPrice,
      refAmount: row.refAmount,
      source: row.source === 'order' ? 'order' : 'target',
      ...(row.targetWeight == null ? {} : { targetWeight: row.targetWeight }),
    },
    simulatedStatus:
      row.simulatedStatus === 'filled' || row.simulatedStatus === 'blocked'
        ? row.simulatedStatus
        : 'pending',
    simulatedShares: row.simulatedShares,
    simulatedPrice: row.simulatedPrice,
    simulatedFee: row.simulatedFee,
    simulatedSlippage: row.simulatedSlippage,
    simulatedReason: row.simulatedReason,
    actualStatus:
      row.actualStatus === 'filled' || row.actualStatus === 'skipped'
        ? row.actualStatus
        : 'pending',
    actualShares: row.actualShares,
    actualPrice: row.actualPrice,
    actualFee: row.actualFee,
    actualReason: row.actualReason,
    actualNote: row.actualNote,
    actualRecordedAt: row.actualRecordedAt?.toISOString() ?? null,
  };
}

async function rebuildDeploymentAccount(
  deploymentId: string,
  kind: AccountKind,
  throughDate: string,
  fullReplay: boolean,
): Promise<void> {
  const deployment = await prisma.strategyDeployment.findUnique({
    where: { id: deploymentId },
    select: { config: true },
  });
  const baseline = await prisma.strategyAccountSnapshot.findFirst({
    where: { deploymentId, kind, isBaseline: true },
    orderBy: { tradeDate: 'asc' },
  });
  if (!deployment || !baseline) {
    return;
  }

  if (fullReplay) {
    await prisma.strategyAccountSnapshot.deleteMany({
      where: { deploymentId, kind, isBaseline: false },
    });
  }
  const latest = fullReplay
    ? baseline
    : ((await prisma.strategyAccountSnapshot.findFirst({
        where: { deploymentId, kind, tradeDate: { lte: throughDate } },
        orderBy: { tradeDate: 'desc' },
      })) ?? baseline);
  const runs = await prisma.signalRun.findMany({
    where: {
      deploymentId,
      status: 'done',
      execDate: { gt: latest.tradeDate, lte: throughDate },
    },
    orderBy: { execDate: 'asc' },
    include: { executions: { orderBy: { signalIndex: 'asc' } } },
  });
  if (runs.length === 0) {
    return;
  }

  let state: AccountState = {
    cash: latest.cash,
    positions: parsePositions(latest.positions),
  };
  const config = deployment.config as unknown as BacktestConfig;
  const cost = { ...DEFAULT_COST, ...config.cost };
  for (const run of runs) {
    const codes = [
      ...new Set([
        ...state.positions.map((position) => position.code),
        ...run.executions.map((execution) => execution.code),
      ]),
    ];
    const [quotes, nextDate] = await Promise.all([
      loadMarketQuotes(run.execDate, codes),
      nextTradingDate(run.execDate),
    ]);
    const replay = replayAccountDay(
      state,
      run.executions as unknown as ReplayOrder[],
      quotes,
      run.execDate,
      nextDate ?? run.execDate,
      cost,
      kind,
    );
    state = replay.state;
    const marketValue = state.positions.reduce(
      (sum, position) => sum + position.shares * position.markPrice,
      0,
    );
    await prisma.$transaction(async (transaction) => {
      if (kind === 'simulation') {
        for (const update of replay.simulationUpdates) {
          await transaction.signalExecution.update({
            where: { id: update.id },
            data: {
              simulatedStatus: update.status,
              simulatedShares: update.shares,
              simulatedPrice: update.price,
              simulatedFee: update.fee,
              simulatedSlippage: update.slippage,
              simulatedReason: update.reason,
            },
          });
        }
      }
      await transaction.strategyAccountSnapshot.upsert({
        where: {
          deploymentId_kind_tradeDate: {
            deploymentId,
            kind,
            tradeDate: run.execDate,
          },
        },
        create: {
          id: ulid(),
          userId: run.userId,
          deploymentId,
          kind,
          tradeDate: run.execDate,
          cash: state.cash,
          marketValue,
          equity: state.cash + marketValue,
          positions: state.positions as unknown as Prisma.InputJsonValue,
          sourceRunId: run.id,
        },
        update: {
          cash: state.cash,
          marketValue,
          equity: state.cash + marketValue,
          positions: state.positions as unknown as Prisma.InputJsonValue,
          sourceRunId: run.id,
        },
      });
    });
  }
}

export function replayAccountDay(
  prior: AccountState,
  orders: ReplayOrder[],
  quotes: Map<string, MarketQuote>,
  tradeDate: string,
  nextDate: string,
  cost: CostModel,
  kind: AccountKind,
): { state: AccountState; simulationUpdates: SimulationUpdate[] } {
  const state: AccountState = {
    cash: prior.cash,
    positions: prior.positions.map((position) => ({ ...position })),
  };
  const positions = new Map(state.positions.map((position) => [position.code, position]));
  const simulationUpdates: SimulationUpdate[] = [];
  const ordered = [...orders].sort((left, right) => {
    if (left.action === right.action) {
      return 0;
    }
    return left.action === 'sell' ? -1 : 1;
  });

  for (const order of ordered) {
    if (kind === 'actual' && order.actualStatus !== 'filled') {
      continue;
    }
    const quote = quotes.get(order.code);
    const requestedShares = kind === 'actual' ? (order.actualShares ?? 0) : order.requestedShares;
    const marketPrice = quote?.open ?? null;
    if (kind === 'simulation' && (marketPrice == null || marketPrice <= 0)) {
      simulationUpdates.push(blockedUpdate(order.id, 'suspended'));
      continue;
    }
    if (
      kind === 'simulation' &&
      limitBlocked(order.action, marketPrice!, quote?.upLimit ?? null, quote?.downLimit ?? null)
    ) {
      simulationUpdates.push(
        blockedUpdate(order.id, order.action === 'buy' ? 'up_limit' : 'down_limit'),
      );
      continue;
    }

    const position = positions.get(order.code);
    let shares = requestedShares;
    if (order.action === 'sell') {
      if (!position || position.sellableFrom > tradeDate || position.shares <= 0) {
        if (kind === 'simulation') {
          simulationUpdates.push(blockedUpdate(order.id, 'position_unavailable'));
        }
        continue;
      }
      shares = Math.min(shares, position.shares);
    }
    const fillPrice =
      kind === 'actual'
        ? order.actualPrice!
        : simulatedPrice(order.action, marketPrice!, shares * marketPrice!, quote?.amount, cost);
    if (order.action === 'buy' && kind === 'simulation') {
      shares = Math.min(shares, affordableShares(state.cash, fillPrice, order.assetType, cost));
      shares = Math.floor(shares / 100) * 100;
    }
    if (shares <= 0 || fillPrice <= 0) {
      if (kind === 'simulation') {
        simulationUpdates.push(blockedUpdate(order.id, 'insufficient_cash'));
      }
      continue;
    }

    const value = shares * fillPrice;
    const fee =
      kind === 'actual' && order.actualFee != null
        ? order.actualFee
        : executionFee(order.action, value, order.assetType, cost);
    if (order.action === 'buy') {
      state.cash -= value + fee;
      const nextPosition = position ?? {
        code: order.code,
        name: order.name,
        assetType: order.assetType,
        shares: 0,
        avgCost: 0,
        markPrice: fillPrice,
        sellableFrom: nextDate,
      };
      nextPosition.avgCost =
        (nextPosition.avgCost * nextPosition.shares + value + fee) / (nextPosition.shares + shares);
      nextPosition.shares += shares;
      nextPosition.markPrice = fillPrice;
      nextPosition.sellableFrom = nextDate;
      positions.set(order.code, nextPosition);
    } else {
      state.cash += value - fee;
      position!.shares -= shares;
      position!.markPrice = fillPrice;
      if (position!.shares < 1e-6) {
        positions.delete(order.code);
      }
    }
    if (kind === 'simulation') {
      simulationUpdates.push({
        id: order.id,
        status: 'filled',
        shares,
        price: fillPrice,
        fee,
        slippage: Math.abs(fillPrice - marketPrice!) * shares,
        reason: shares < order.requestedShares ? 'partial' : null,
      });
    }
  }

  for (const position of positions.values()) {
    const close = quotes.get(position.code)?.close;
    if (close != null && close > 0) {
      position.markPrice = close;
    }
  }
  state.positions = [...positions.values()].sort((left, right) =>
    left.code.localeCompare(right.code),
  );
  return { state, simulationUpdates };
}

function simulatedPrice(
  action: 'buy' | 'sell',
  open: number,
  notional: number,
  amountThousandYuan: number | null | undefined,
  cost: CostModel,
): number {
  const base = cost.slippageBps / 10_000;
  const turnover = (amountThousandYuan ?? 0) * 1000;
  const impact = turnover > 0 ? cost.impactCoef * (notional / turnover) : 0;
  const slippage = Math.min(base + impact, MAX_SLIPPAGE);
  return action === 'buy' ? open * (1 + slippage) : open * (1 - slippage);
}

function executionFee(
  action: 'buy' | 'sell',
  value: number,
  assetType: CashAssetType,
  cost: CostModel,
): number {
  const commission = Math.max(value * cost.commission, cost.minCommission);
  const transfer = assetType === 'stock' ? value * cost.transferFee : 0;
  const stamp = action === 'sell' && assetType === 'stock' ? value * cost.stampDuty : 0;
  return commission + transfer + stamp;
}

function affordableShares(
  cash: number,
  price: number,
  assetType: CashAssetType,
  cost: CostModel,
): number {
  const transferFee = assetType === 'stock' ? cost.transferFee : 0;
  return Math.max(0, Math.floor(cash / (price * (1 + cost.commission + transferFee))));
}

function limitBlocked(
  action: 'buy' | 'sell',
  open: number,
  upLimit: number | null,
  downLimit: number | null,
): boolean {
  const epsilon = 1e-3;
  return action === 'buy'
    ? upLimit != null && open >= upLimit - epsilon
    : downLimit != null && open <= downLimit + epsilon;
}

function blockedUpdate(id: string, reason: string): SimulationUpdate {
  return {
    id,
    status: 'blocked',
    shares: null,
    price: null,
    fee: null,
    slippage: null,
    reason,
  };
}

async function loadMarketQuotes(
  tradeDate: string,
  codes: string[],
): Promise<Map<string, MarketQuote>> {
  const [stocks, etfs, limits] = await Promise.all([
    prisma.daily.findMany({
      where: { tradeDate, tsCode: { in: codes } },
      select: { tsCode: true, open: true, close: true, amount: true },
    }),
    prisma.etfDaily.findMany({
      where: { tradeDate, tsCode: { in: codes } },
      select: { tsCode: true, open: true, close: true, amount: true },
    }),
    prisma.stkLimit.findMany({
      where: { tradeDate, tsCode: { in: codes } },
      select: { tsCode: true, upLimit: true, downLimit: true },
    }),
  ]);
  const limitByCode = new Map(limits.map((limit) => [limit.tsCode, limit]));
  return new Map(
    [...stocks, ...etfs].map((row) => {
      const limit = limitByCode.get(row.tsCode);
      return [
        row.tsCode,
        {
          open: row.open,
          close: row.close,
          amount: row.amount,
          upLimit: limit?.upLimit ?? null,
          downLimit: limit?.downLimit ?? null,
        },
      ];
    }),
  );
}

async function nextTradingDate(tradeDate: string): Promise<string | null> {
  const next = await prisma.tradeCal.findFirst({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: tradeDate } },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  return next?.calDate ?? null;
}

function parsePositions(value: unknown): AccountPosition[] {
  return Array.isArray(value) ? (value as unknown as AccountPosition[]) : [];
}

function snapshotPoints(
  rows: Array<{
    kind: string;
    tradeDate: string;
    cash: number;
    marketValue: number;
    equity: number;
    isBaseline: boolean;
  }>,
  kind: AccountKind,
): StrategyAccountPoint[] {
  return rows
    .filter((row) => row.kind === kind)
    .map((row) => ({
      date: row.tradeDate,
      cash: row.cash,
      marketValue: row.marketValue,
      equity: row.equity,
      isBaseline: row.isBaseline,
    }));
}
