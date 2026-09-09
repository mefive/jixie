import { ulid } from 'ulid';
import type { ModelPositionSnapshot, SignalItem } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../infra/database/prisma.js';

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
      const immediateSignals = signals.flatMap((signal, signalIndex) =>
        signal.source === 'conditional' ? [] : [{ signal, signalIndex }],
      );
      await transaction.signalExecution.createMany({
        data: immediateSignals.map(({ signal, signalIndex }) => ({
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
