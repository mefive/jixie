import { ulid } from 'ulid';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../infra/database/prisma.js';
import { initializeJobLogs } from '../../infra/jobs/logs.js';
import { waitForJobCompletion, wakeJobQueue } from '../../infra/jobs/queue.js';
import { governmentYieldCurveReady } from '../../market/rates/signal-readiness.js';
import { factorDependenciesFromJson } from '../factor-inputs/lineage.js';
import { signalCalendar, signalDataReady } from './readiness.js';

export interface EnqueuedSignalRun {
  runId: string;
  jobId: string | null;
  started: boolean;
  completion: Promise<'done' | 'error' | 'running'>;
}

export async function enqueueSignalRun(
  userId: string,
  deploymentId: string,
  tradeDate: string,
): Promise<
  | { kind: 'ready'; run: EnqueuedSignalRun }
  | { kind: 'not_found' }
  | { kind: 'paused' }
  | { kind: 'invalid_date' }
  | { kind: 'next_date_missing' }
  | { kind: 'data_not_ready' }
> {
  const deployment = await prisma.strategyDeployment.findFirst({
    where: { id: deploymentId, userId },
    select: { id: true, status: true, locale: true, factorDependencies: true },
  });
  if (!deployment) {
    return { kind: 'not_found' };
  }
  if (deployment.status !== 'active') {
    return { kind: 'paused' };
  }

  const calendar = await signalCalendar(tradeDate);
  if (calendar.kind !== 'ready') {
    return calendar;
  }
  if (!(await signalDataReady(tradeDate))) {
    return { kind: 'data_not_ready' };
  }
  const factorDependencies = factorDependenciesFromJson(deployment.factorDependencies) ?? [];
  if (!(await governmentYieldCurveReady(factorDependencies, tradeDate))) {
    return { kind: 'data_not_ready' };
  }

  const start = await prisma.$transaction(async (transaction) => {
    const existing = await transaction.signalRun.findUnique({
      where: { deploymentId_tradeDate: { deploymentId, tradeDate } },
      include: { jobs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (existing?.status === 'done') {
      return {
        kind: 'existing' as const,
        runId: existing.id,
        jobId: existing.jobs[0]?.id ?? null,
        status: 'done' as const,
      };
    }
    if (existing?.status === 'running') {
      return {
        kind: 'existing' as const,
        runId: existing.id,
        jobId: existing.jobs[0]?.id ?? null,
        status: 'running' as const,
      };
    }

    const runId = existing?.id ?? ulid();
    if (existing) {
      await transaction.signalRun.update({
        where: { id: runId },
        data: {
          status: 'running',
          execDate: calendar.execDate,
          error: null,
          dataCutoff: null,
          modelEquity: null,
          modelCash: null,
          modelPositions: [] as Prisma.InputJsonValue,
          signals: [] as Prisma.InputJsonValue,
          factorInputs: [] as Prisma.InputJsonValue,
          notifiedAt: null,
          notificationError: null,
        },
      });
    } else {
      await transaction.signalRun.create({
        data: {
          id: runId,
          userId,
          deploymentId,
          strategyId: await deploymentStrategyId(transaction, deploymentId),
          tradeDate,
          execDate: calendar.execDate,
          status: 'running',
          factorDependencies:
            deployment.factorDependencies == null
              ? undefined
              : (deployment.factorDependencies as Prisma.InputJsonValue),
        },
      });
    }

    const jobId = ulid();
    await transaction.job.create({
      data: {
        id: jobId,
        userId,
        kind: 'signal',
        key: runId,
        status: 'queued',
        signalRunId: runId,
        payload: {
          task: 'signal',
          runId,
          locale: deployment.locale === 'en' ? 'en' : 'zh',
        },
      },
    });
    return { kind: 'start' as const, runId, jobId };
  });

  if (start.kind === 'existing') {
    const completion = start.jobId
      ? waitForJobCompletion(start.jobId).then((status) =>
          status === 'done' ? ('done' as const) : ('error' as const),
        )
      : Promise.resolve(start.status);
    return {
      kind: 'ready',
      run: {
        runId: start.runId,
        jobId: start.jobId,
        started: false,
        completion,
      },
    };
  }

  initializeJobLogs(start.jobId);
  wakeJobQueue();
  const completion = waitForJobCompletion(start.jobId).then((status) =>
    status === 'done' ? ('done' as const) : ('error' as const),
  );
  return {
    kind: 'ready',
    run: {
      runId: start.runId,
      jobId: start.jobId,
      started: true,
      completion,
    },
  };
}

async function deploymentStrategyId(
  transaction: Prisma.TransactionClient,
  deploymentId: string,
): Promise<string> {
  const deployment = await transaction.strategyDeployment.findUniqueOrThrow({
    where: { id: deploymentId },
    select: { strategyId: true },
  });
  return deployment.strategyId;
}
