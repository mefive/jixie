import { ulid } from 'ulid';
import type { LogLine } from '@jixie/shared';
import { prisma } from './prisma.js';

/**
 * Shared background-job registry for backtest + factor analysis.
 *  - Status is durable (the Job table) → cross-client resume (`findRunningJob`) + boot stale-marking.
 *  - Progress logs stream in-memory here (cheap, no per-line DB write); on finish the whole buffer is
 *    flushed once to Job.logs, so reopening a finished job (after the 5-min eviction, or a restart) still
 *    shows its run log. Only a hard-crashed run (finishJob never ran) loses its logs — those were already
 *    streamed live, and boot marks the job stale.
 *  - Each line is a tagged LogLine (system vs user), tagged at the worker boundary.
 *  - The result is NOT stored on the job; it lands on the entity (FactorReport.payload / Strategy.lastResult).
 * A job's `key` ties it to what it computes (factor: `${factor}|${freq}|${start}|${end}`, backtest:
 * the strategyId), so a refreshed page can find "my running job for this key" and re-attach.
 */
export type JobKind = 'backtest' | 'factor';
export type JobStatus = 'running' | 'done' | 'error' | 'stale';

const logsByJob = new Map<string, LogLine[]>();
const LOG_TTL_MS = 5 * 60_000; // evict a finished job's in-memory logs after 5 min (DB copy remains)

/** Create a running job (DB row + in-memory log buffer). Returns the jobId. */
export async function createJob(userId: string, kind: JobKind, key: string): Promise<string> {
  const id = ulid();
  await prisma.job.create({ data: { id, userId, kind, key, status: 'running' } });
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
      data: { status, error: error ?? null, logs: logs ? JSON.stringify(logs) : undefined },
    })
    .catch(() => {});
  setTimeout(() => logsByJob.delete(jobId), LOG_TTL_MS).unref?.();
}

/** Poll an owner-scoped job: DB status + logs after `since` — live in memory, else from the DB copy. */
export async function getJob(userId: string, jobId: string, since = 0) {
  const job = await prisma.job.findFirst({ where: { id: jobId, userId } });
  if (!job) {
    return null;
  }
  const logs = logsByJob.get(jobId) ?? parsePersistedLogs(job.logs);
  return {
    status: job.status as JobStatus,
    error: job.error,
    logs: logs.slice(since),
    nextSince: logs.length,
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

/** A user's currently-running job for a (kind, key) — to re-attach after a refresh (newest wins). */
export async function findRunningJob(
  userId: string,
  kind: JobKind,
  key: string,
): Promise<string | null> {
  const job = await prisma.job.findFirst({
    where: { userId, kind, key, status: 'running' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return job?.id ?? null;
}

/** On boot: any job still 'running' is a zombie (its worker died with the previous process) → stale. */
export async function markRunningJobsStale(): Promise<number> {
  const { count } = await prisma.job.updateMany({
    where: { status: 'running' },
    data: { status: 'stale' },
  });
  return count;
}
