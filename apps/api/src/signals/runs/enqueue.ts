import { codeConfigSchema } from '@jixie/shared/api/strategy';
import type { SignalsRunJobPayload } from './job-payload.js';
import { signalRunState, currentSignalJob } from '#signals/runs/state.js';
import { getDatabase } from '#infra/database/prisma.js';
import { JobScheduler } from '#jobs/job-scheduler.js';
import { JobService } from '#jobs/job-service.js';
import type { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { SignalsError } from '../errors.js';
import { StrategyFactor } from '#strategy/factors/strategy-factor.js';
import { governmentYieldCurveReady } from '../factor-inputs/rates.js';
import { resolveSignalExecutionDate, isSignalDataReady } from './readiness.js';

/**
 * 返回信号入队后可查询的运行与任务身份。
 *
 * Return the persisted run and job identities created by signal enqueueing.
 */
export interface EnqueuedSignalRun {
  runId: string;
  jobId: string | null;
  started: boolean;
  completion: Promise<'done' | 'error' | 'running'>;
}

/**
 * 为部署与信号日期创建运行和后台任务，保持重复提交与状态关联一致。
 *
 * Create a signal run and background job for a deployment and date with consistent submission
 * state.
 */
export async function enqueueSignalRun(
  userId: string,
  deploymentId: string,
  tradeDate: string,
  signal?: AbortSignal,
): Promise<EnqueuedSignalRun> {
  const deployment = await getDatabase().strategyDeployment.findFirst({
    where: { id: deploymentId, userId },
    select: { id: true, status: true, locale: true, config: true, factorDependencies: true },
  });
  if (!deployment) {
    throw new SignalsError('deployment_not_found');
  }
  if (deployment.status !== 'active') {
    throw new SignalsError('paused');
  }

  const calendar = await resolveSignalExecutionDate(tradeDate);
  if (calendar.kind !== 'ready') {
    throw new SignalsError(calendar.kind);
  }
  if (!(await isSignalDataReady(tradeDate, codeConfigSchema.parse(deployment.config)))) {
    throw new SignalsError('data_not_ready', { params: { date: tradeDate } });
  }
  const factorDependencies =
    StrategyFactor.dependenciesFromJson(deployment.factorDependencies) ?? [];
  if (!(await governmentYieldCurveReady(factorDependencies, tradeDate))) {
    throw new SignalsError('data_not_ready', { params: { date: tradeDate } });
  }

  const start = await getDatabase().$transaction(async (transaction) => {
    // Recheck after readiness work so a completed pause cannot admit a new run.
    const currentDeployment = await transaction.strategyDeployment.findUnique({
      where: { id: deploymentId },
      select: { status: true },
    });
    if (!currentDeployment || currentDeployment.status !== 'active') {
      throw new SignalsError('paused');
    }
    const existing = await transaction.signalRun
      .findUnique({
        where: { deploymentId_tradeDate: { deploymentId, tradeDate } },
        include: { jobs: currentSignalJob },
      })
      .then((row) => (row ? signalRunState(row) : row));
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
      const recorded = await transaction.signalFill.count({
        where: { execution: { signalRunId: runId } },
      });
      if (recorded > 0) {
        throw new SignalsError('execution_unavailable');
      }
      await transaction.signalRun.update({
        where: { id: runId },
        data: {
          legacyStatus: null,
          legacyError: null,
          execDate: calendar.execDate,
          modelAccounts: undefined,
          intentSnapshot: [],
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
          legacyStatus: null,
          legacyError: null,
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
        } satisfies SignalsRunJobPayload,
      },
    });
    return { kind: 'start' as const, runId, jobId };
  });

  if (start.kind === 'existing') {
    const completion = start.jobId
      ? JobService.waitForCompletion(start.jobId, signal).then((status) =>
          status === 'done'
            ? ('done' as const)
            : status === 'running'
              ? ('running' as const)
              : ('error' as const),
        )
      : Promise.resolve(start.status);
    return {
      runId: start.runId,
      jobId: start.jobId,
      started: false,
      completion,
    };
  }

  JobScheduler.wake();
  const completion = JobService.waitForCompletion(start.jobId, signal).then((status) =>
    status === 'done'
      ? ('done' as const)
      : status === 'running'
        ? ('running' as const)
        : ('error' as const),
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
