import { ulid } from 'ulid';
import type { LogLine } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

/**
 * Shared background-job registry for backtests, factor analysis, strategy scans, and daily signals.
 *  - Status is durable (the Job table) → cross-client resume (`findRunningJob`) + boot stale-marking.
 *  - Progress logs stream in-memory here (cheap, no per-line DB write); on finish the whole buffer is
 *    flushed once to Job.logs, so reopening a finished job (after the 5-min eviction, or a restart) still
 *    shows its run log. Only a hard-crashed run (finishJob never ran) loses its logs — those were already
 *    streamed live, and boot marks the job stale.
 *  - Each line is a tagged LogLine (system vs user), tagged at the worker boundary.
 *  - The result is NOT stored on the job; it lands on the entity (FactorReport.payload / Strategy.lastResult).
 * A job's `key` ties it to what it computes (factor: variantKey, backtest: strategyId). Factor pages
 * restore through the report relation; legacy findRunningJob remains for backtests and correlation.
 */
export type JobKind = 'backtest' | 'factor' | 'strategy-scan' | 'signal' | 'research-curator';
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'stale';
export type ActiveJobStatus = Extract<JobStatus, 'queued' | 'running'>;

export const ACTIVE_JOB_STATUSES: ActiveJobStatus[] = ['queued', 'running'];

const logsByJob = new Map<string, LogLine[]>();
const LOG_TTL_MS = 5 * 60_000; // evict a finished job's in-memory logs after 5 min (DB copy remains)

/** Create a durable queued job (DB row + in-memory log buffer). Returns the jobId. */
export async function createJob(
  userId: string,
  kind: JobKind,
  key: string,
  payload: Prisma.InputJsonValue,
): Promise<string> {
  const id = ulid();
  await prisma.job.create({ data: { id, userId, kind, key, status: 'queued', payload } });
  initializeJobLogs(id);
  return id;
}

/** Attach the in-memory log buffer after a Job row was created by a wider database transaction. */
export function initializeJobLogs(jobId: string): void {
  logsByJob.set(jobId, []);
}

export function appendLog(jobId: string, entry: LogLine): void {
  logsByJob.get(jobId)?.push(entry);
}

/** Mark a job done/error; flush its logs to the DB, then schedule the in-memory copy for eviction. */
export async function finishJob(
  jobId: string,
  status: 'done' | 'error',
  error?: string,
): Promise<void> {
  const logs = logsByJob.get(jobId);
  await prisma.job
    .update({
      where: { id: jobId },
      data: {
        status,
        error: error ?? null,
        logs: logs ? JSON.stringify(logs) : undefined,
        finishedAt: new Date(),
      },
    })
    .catch(() => {});
  setTimeout(() => logsByJob.delete(jobId), LOG_TTL_MS).unref?.();
}

/** Finish a factor-analysis job and its one-to-one report in the same transaction. */
export async function finishFactorReportJob(
  jobId: string,
  factorReportId: string,
  status: 'done' | 'error',
  payload?: string,
  error?: string,
  reportError?: string,
): Promise<void> {
  const logs = logsByJob.get(jobId);
  const computedAt = status === 'done' ? new Date() : null;

  await prisma.$transaction([
    prisma.factorReport.update({
      where: { id: factorReportId },
      data: {
        status,
        payload: status === 'done' ? payload : undefined,
        computedAt,
        error: status === 'error' ? (reportError ?? error ?? null) : null,
      },
    }),
    prisma.job.update({
      where: { id: jobId },
      data: {
        status,
        error: error ?? null,
        logs: logs ? JSON.stringify(logs) : undefined,
        finishedAt: new Date(),
      },
    }),
  ]);
  setTimeout(() => logsByJob.delete(jobId), LOG_TTL_MS).unref?.();
}

/** Finish a strategy parameter scan and its job atomically. */
export async function finishStrategyScanJob(
  jobId: string,
  reportId: string,
  status: 'done' | 'error',
  payload?: Prisma.InputJsonValue,
  error?: string,
): Promise<void> {
  const logs = logsByJob.get(jobId);
  await prisma.$transaction([
    prisma.strategyScanReport.update({
      where: { id: reportId },
      data: {
        status,
        payload: status === 'done' ? payload : undefined,
        error: status === 'error' ? (error ?? null) : null,
      },
    }),
    prisma.job.update({
      where: { id: jobId },
      data: {
        status,
        error: error ?? null,
        logs: logs ? JSON.stringify(logs) : undefined,
        finishedAt: new Date(),
      },
    }),
  ]);
  setTimeout(() => logsByJob.delete(jobId), LOG_TTL_MS).unref?.();
}

/** Finish one daily-signal attempt and its durable run atomically. */
export async function finishSignalRunJob(
  jobId: string,
  signalRunId: string,
  status: 'done' | 'error',
  output?: {
    dataCutoff: string;
    modelEquity: number;
    modelCash: number;
    modelPositions: Prisma.InputJsonValue;
    signals: Prisma.InputJsonValue;
    factorInputs: Prisma.InputJsonValue;
  },
  error?: string,
): Promise<void> {
  const logs = logsByJob.get(jobId);
  await prisma.$transaction([
    prisma.signalRun.update({
      where: { id: signalRunId },
      data: {
        status,
        dataCutoff: status === 'done' ? output?.dataCutoff : undefined,
        modelEquity: status === 'done' ? output?.modelEquity : undefined,
        modelCash: status === 'done' ? output?.modelCash : undefined,
        modelPositions: status === 'done' ? output?.modelPositions : undefined,
        signals: status === 'done' ? output?.signals : undefined,
        factorInputs: status === 'done' ? output?.factorInputs : undefined,
        error: status === 'error' ? (error ?? null) : null,
      },
    }),
    prisma.job.update({
      where: { id: jobId },
      data: {
        status,
        error: error ?? null,
        logs: logs ? JSON.stringify(logs) : undefined,
        finishedAt: new Date(),
      },
    }),
  ]);
  setTimeout(() => logsByJob.delete(jobId), LOG_TTL_MS).unref?.();
}

/** Poll an owner-scoped job: DB status + logs after `since` — live in memory, else from the DB copy. */
export async function getJob(userId: string, jobId: string, since = 0) {
  const job = await prisma.job.findFirst({ where: { id: jobId, userId } });
  if (!job) {
    return null;
  }
  const logs = logsByJob.get(jobId) ?? parsePersistedLogs(job.logs);
  const queuePosition =
    job.status === 'queued'
      ? await prisma.job.count({
          where: {
            status: 'queued',
            OR: [
              { queuedAt: { lt: job.queuedAt } },
              { queuedAt: job.queuedAt, id: { lte: job.id } },
            ],
          },
        })
      : undefined;
  return {
    status: job.status as JobStatus,
    factorReportId: job.factorReportId,
    error: job.error,
    logs: logs.slice(since),
    nextSince: logs.length,
    queuePosition,
  };
}

/** Parse the JSON blob flushed to Job.logs; a malformed/absent value degrades to no logs. */
function parsePersistedLogs(raw: string | null): LogLine[] {
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as LogLine[];
  } catch {
    return [];
  }
}

/** A user's active queued/running job for a (kind, key) — re-attach after a refresh. */
export async function findRunningJob(
  userId: string,
  kind: JobKind,
  key: string,
): Promise<string | null> {
  const job = await prisma.job.findFirst({
    where: { userId, kind, key, status: { in: ACTIVE_JOB_STATUSES } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return job?.id ?? null;
}

/** On boot: a running job is a zombie; queued jobs remain resumable through their frozen payload. */
export async function markRunningJobsStale(): Promise<number> {
  return prisma.$transaction(async (transaction) => {
    const running = await transaction.job.findMany({
      where: { status: 'running' },
      select: {
        factorReportId: true,
        strategyScanReportId: true,
        signalRunId: true,
        researchCuratorRunId: true,
      },
    });
    const reportIds = running
      .map((job) => job.factorReportId)
      .filter((reportId): reportId is string => !!reportId);

    if (reportIds.length > 0) {
      await transaction.factorReport.updateMany({
        where: { id: { in: reportIds }, status: 'running' },
        data: { status: 'stale', error: null },
      });
    }
    const scanReportIds = running
      .map((job) => job.strategyScanReportId)
      .filter((reportId): reportId is string => !!reportId);
    if (scanReportIds.length > 0) {
      await transaction.strategyScanReport.updateMany({
        where: { id: { in: scanReportIds }, status: 'running' },
        data: { status: 'stale', error: null },
      });
    }
    const signalRunIds = running
      .map((job) => job.signalRunId)
      .filter((runId): runId is string => !!runId);
    if (signalRunIds.length > 0) {
      await transaction.signalRun.updateMany({
        where: { id: { in: signalRunIds }, status: 'running' },
        data: { status: 'stale', error: null },
      });
    }
    const curatorRunIds = running
      .map((job) => job.researchCuratorRunId)
      .filter((runId): runId is string => !!runId);
    if (curatorRunIds.length > 0) {
      await transaction.researchCuratorRun.updateMany({
        where: { id: { in: curatorRunIds }, status: 'running' },
        data: { status: 'stale', error: null },
      });
    }
    const { count } = await transaction.job.updateMany({
      where: { status: 'running' },
      data: { status: 'stale', finishedAt: new Date() },
    });

    return count;
  });
}

/** Atomically claim one queued job for a scheduler slot. */
export async function claimQueuedJob(jobId: string): Promise<boolean> {
  const { count } = await prisma.job.updateMany({
    where: { id: jobId, status: 'queued' },
    data: { status: 'running', startedAt: new Date(), error: null },
  });
  return count === 1;
}

/** Mark a job and any one-to-one result entity failed when its runner cannot be reconstructed. */
export async function failJobAndEntity(jobId: string, error: string): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      factorReportId: true,
      strategyScanReportId: true,
      signalRunId: true,
      researchCuratorRunId: true,
    },
  });
  if (!job) {
    return;
  }
  const operations: Prisma.PrismaPromise<unknown>[] = [
    prisma.job.update({
      where: { id: jobId },
      data: { status: 'error', error, finishedAt: new Date() },
    }),
  ];
  if (job.factorReportId) {
    operations.push(
      prisma.factorReport.update({
        where: { id: job.factorReportId },
        data: { status: 'error', error },
      }),
    );
  }
  if (job.strategyScanReportId) {
    operations.push(
      prisma.strategyScanReport.update({
        where: { id: job.strategyScanReportId },
        data: { status: 'error', error },
      }),
    );
  }
  if (job.signalRunId) {
    operations.push(
      prisma.signalRun.update({
        where: { id: job.signalRunId },
        data: { status: 'error', error },
      }),
    );
  }
  if (job.researchCuratorRunId) {
    operations.push(
      prisma.researchCuratorRun.update({
        where: { id: job.researchCuratorRunId },
        data: { status: 'error', error },
      }),
    );
  }
  await prisma.$transaction(operations);
}
