import { signalRunState, currentSignalJob } from './state.js';
import { prisma } from '#infra/database/prisma.js';
import { JobService } from '#jobs/service.js';
import type {
  FactorInputSummary,
  ModelPositionSnapshot,
  SignalItem,
  SignalRun,
  StrategyDeployment,
} from '@jixie/shared';
import { executionWire } from '../accounting/read.js';
import { deploymentWire } from '../deployments/read.js';
import { SignalsError } from '../errors.js';
import { factorDependenciesFromJson } from '../factor-inputs/lineage.js';

export async function listDeploymentLatestRuns(
  userId: string,
): Promise<Array<{ deployment: StrategyDeployment; run: SignalRun | null }>> {
  const rows = await prisma.strategyDeployment.findMany({
    where: { userId },
    orderBy: [{ status: 'asc' }, { deployedAt: 'desc' }, { id: 'desc' }],
    include: {
      signalRuns: {
        orderBy: { tradeDate: 'desc' },
        take: 1,
        include: {
          jobs: currentSignalJob,
          executions: { orderBy: { signalIndex: 'asc' } },
        },
      },
    },
  });
  return rows.map((row) => ({
    deployment: deploymentWire(row),
    run: row.signalRuns[0]
      ? signalRunWire(signalRunState(row.signalRuns[0]), row.strategyName)
      : null,
  }));
}

export async function listSignalRuns(
  userId: string,
  deploymentId: string,
  limit: number,
): Promise<SignalRun[]> {
  const deployment = await prisma.strategyDeployment.findFirst({
    where: { id: deploymentId, userId },
    select: { id: true, strategyName: true },
  });
  if (!deployment) {
    throw new SignalsError('deployment_not_found');
  }
  const rows = await prisma.signalRun.findMany({
    where: { deploymentId, userId },
    orderBy: { tradeDate: 'desc' },
    take: limit,
    include: {
      jobs: currentSignalJob,
      executions: { orderBy: { signalIndex: 'asc' } },
    },
  });
  return rows.map((row) => signalRunWire(signalRunState(row), deployment.strategyName));
}

export async function getSignalRun(userId: string, runId: string): Promise<SignalRun> {
  const row = await prisma.signalRun.findFirst({
    where: { id: runId, userId },
    include: {
      deployment: { select: { strategyName: true } },
      jobs: currentSignalJob,
      executions: { orderBy: { signalIndex: 'asc' } },
    },
  });
  if (!row) {
    throw new SignalsError('run_not_found');
  }
  return signalRunWire(signalRunState(row), row.deployment.strategyName);
}

export async function getSignalRunJob(userId: string, jobId: string, since = 0) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, userId, kind: 'signal' },
    select: { id: true },
  });
  if (!job) {
    throw new SignalsError('job_not_found');
  }
  const result = await JobService.get(userId, job.id, since);
  if (!result) {
    throw new SignalsError('job_not_found');
  }
  return result;
}

function signalRunWire(
  row: {
    id: string;
    deploymentId: string;
    strategyId: string;
    tradeDate: string;
    execDate: string;
    status: string;
    factorDependencies: unknown;
    factorInputs: unknown;
    dataCutoff: string | null;
    modelEquity: number | null;
    modelCash: number | null;
    modelPositions: unknown;
    signals: unknown;
    error: string | null;
    notifiedAt: Date | null;
    notificationError: string | null;
    createdAt: Date;
    updatedAt: Date;
    jobs?: Array<{ id: string }>;
    executions?: Parameters<typeof executionWire>[0][];
  },
  strategyName: string,
): SignalRun {
  return {
    id: row.id,
    deploymentId: row.deploymentId,
    strategyId: row.strategyId,
    strategyName,
    tradeDate: row.tradeDate,
    execDate: row.execDate,
    status:
      row.status === 'done' || row.status === 'error' || row.status === 'stale'
        ? row.status
        : 'running',
    factorDependencies: factorDependenciesFromJson(row.factorDependencies) ?? [],
    factorInputs: Array.isArray(row.factorInputs)
      ? (row.factorInputs as unknown as FactorInputSummary[])
      : [],
    dataCutoff: row.dataCutoff,
    modelEquity: row.modelEquity,
    modelCash: row.modelCash,
    modelPositions: Array.isArray(row.modelPositions)
      ? (row.modelPositions as unknown as ModelPositionSnapshot[])
      : [],
    signals: Array.isArray(row.signals) ? (row.signals as unknown as SignalItem[]) : [],
    executions: row.executions?.map(executionWire) ?? [],
    error: row.error,
    notifiedAt: row.notifiedAt?.toISOString() ?? null,
    notificationError: row.notificationError,
    jobId: row.jobs?.[0]?.id ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
