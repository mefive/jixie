import type {
  SignalExecution,
  StrategyAccountPoint,
  StrategyExecutionOverview,
} from '@jixie/shared';
import { prisma } from '../../infra/database/prisma.js';
import type { AccountKind } from './replay.js';

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
