import { ulid } from 'ulid';
import { prisma } from './prisma.js';

/**
 * Shared background-job registry for backtest + factor analysis.
 *  - Status is durable (the Job table) → cross-client resume (`findRunningJob`) + boot stale-marking.
 *  - Progress logs stay in-memory here (ephemeral; lost on restart, which is fine — they're progress).
 *  - The result is NOT stored on the job; it lands on the entity (FactorReport.payload / Strategy.lastResult).
 * A job's `key` ties it to what it computes (factor: `${factor}|${freq}|${start}|${end}`, backtest:
 * the strategyId), so a refreshed page can find "my running job for this key" and re-attach.
 */
export type JobKind = 'backtest' | 'factor';
export type JobStatus = 'running' | 'done' | 'error' | 'stale';

const logsByJob = new Map<string, string[]>();
const LOG_TTL_MS = 5 * 60_000; // evict a finished job's in-memory logs after 5 min

/** Create a running job (DB row + in-memory log buffer). Returns the jobId. */
export async function createJob(userId: string, kind: JobKind, key: string): Promise<string> {
  const id = ulid();
  await prisma.job.create({ data: { id, userId, kind, key, status: 'running' } });
  logsByJob.set(id, []);
  return id;
}

export function appendLog(jobId: string, line: string): void {
  logsByJob.get(jobId)?.push(line);
}

/** Mark a job done/error; schedule its in-memory logs for eviction. */
export async function finishJob(
  jobId: string,
  status: 'done' | 'error',
  error?: string,
): Promise<void> {
  await prisma.job
    .update({ where: { id: jobId }, data: { status, error: error ?? null } })
    .catch(() => {});
  setTimeout(() => logsByJob.delete(jobId), LOG_TTL_MS).unref?.();
}

/** Poll a job: DB status + the in-memory logs after `since` (empty if the process restarted). */
export async function getJob(jobId: string, since = 0) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    return null;
  }
  const logs = logsByJob.get(jobId) ?? [];
  return {
    status: job.status as JobStatus,
    error: job.error,
    logs: logs.slice(since),
    nextSince: logs.length,
  };
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
