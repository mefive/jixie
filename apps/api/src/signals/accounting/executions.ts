import { prisma } from '#infra/database/prisma.js';
import type { ActualExecutionUpdate } from '@jixie/shared';
import { SignalsError } from '../errors.js';
import { rebuildDeploymentAccount } from './settlement.js';

export async function updateActualExecution(
  userId: string,
  executionId: string,
  input: ActualExecutionUpdate,
): Promise<{ runId: string }> {
  const execution = await prisma.signalExecution.findFirst({
    where: { id: executionId, userId },
    include: {
      signalRun: {
        select: { deploymentId: true, execDate: true, status: true },
      },
    },
  });
  if (!execution) {
    throw new SignalsError('execution_not_found');
  }
  if (execution.signalRun.status !== 'done') {
    throw new SignalsError('execution_unavailable');
  }
  if (input.status !== 'pending' && execution.simulatedStatus === 'pending') {
    throw new SignalsError('execution_unavailable');
  }
  if (input.status === 'filled' && input.shares > execution.requestedShares) {
    throw new SignalsError('execution_shares_invalid');
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
  return { runId: execution.signalRunId };
}
