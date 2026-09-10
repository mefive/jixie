import { ulid } from 'ulid';
import type { BacktestConfig } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { DEFAULT_COST } from '#engine/types.js';
import { prisma } from '#infra/database/prisma.js';
import {
  replayAccountDay,
  type AccountKind,
  type AccountPosition,
  type AccountState,
  type ReplayOrder,
} from './replay.js';
import { loadMarketQuotes, nextTradingDate } from './quotes.js';

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

export async function rebuildDeploymentAccount(
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

function parsePositions(value: unknown): AccountPosition[] {
  return Array.isArray(value) ? (value as unknown as AccountPosition[]) : [];
}
