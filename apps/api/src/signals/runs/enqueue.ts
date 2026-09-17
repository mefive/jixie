import { prisma } from '#infra/database/prisma.js';
import { initializeJobLogs } from '#infra/jobs/logs.js';
import { waitForJobCompletion, wakeJobQueue } from '#infra/jobs/queue.js';
import type { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { SignalsError } from '../errors.js';
import { factorDependenciesFromJson } from '../factor-inputs/lineage.js';
import { governmentYieldCurveReady } from '../factor-inputs/rates.js';
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
): Promise<EnqueuedSignalRun> {
  const deployment = await prisma.strategyDeployment.findFirst({
    where: { id: deploymentId, userId },
    select: { id: true, status: true, locale: true, factorDependencies: true },
  });
  if (!deployment) {
    throw new SignalsError('deployment_not_found');
  }
  if (deployment.status !== 'active') {
    throw new SignalsError('paused');
  }

  const calendar = await signalCalendar(tradeDate);
  if (calendar.kind !== 'ready') {
    throw new SignalsError(calendar.kind);
  }
  if (!(await signalDataReady(tradeDate))) {
    throw new SignalsError('data_not_ready', { params: { date: tradeDate } });
  }
  const factorDependencies = factorDependenciesFromJson(deployment.factorDependencies) ?? [];
  if (!(await governmentYieldCurveReady(factorDependencies, tradeDate))) {
    throw new SignalsError('data_not_ready', { params: { date: tradeDate } });
  }

  const start = await prisma.$transaction(async (transaction) => {
    // Recheck after readiness work so a completed pause cannot admit a new run.
    const currentDeployment = await transaction.strategyDeployment.findUnique({
      where: { id: deploymentId },
      select: { status: true },
    });
    if (!currentDeployment || currentDeployment.status !== 'active') {
      throw new SignalsError('paused');
    }
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
      runId: start.runId,
      jobId: start.jobId,
      started: false,
      completion,
    };
  }

  initializeJobLogs(start.jobId);
  wakeJobQueue();
  const completion = waitForJobCompletion(start.jobId).then((status) =>
    status === 'done' ? ('done' as const) : ('error' as const),
  );
  return {
    runId: start.runId,
    jobId: start.jobId,
    started: true,
    completion,
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
