import { ulid } from 'ulid';
import type { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma.js';
import { initializeJobLogs, readJobLogs } from './logs.js';

export type JobKind = 'backtest' | 'factor' | 'strategy-scan' | 'signal' | 'research-curator';

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'stale';

export type ActiveJobStatus = Extract<JobStatus, 'queued' | 'running'>;

export const ACTIVE_JOB_STATUSES: ActiveJobStatus[] = ['queued', 'running'];

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

export async function getJob(userId: string, jobId: string, since = 0) {
  const job = await prisma.job.findFirst({ where: { id: jobId, userId } });
  if (!job) {
    return null;
  }
  const logs = readJobLogs(jobId, job.logs);
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
    backtestReportId: job.backtestReportId,
    error: job.error,
    logs: logs.slice(since),
    nextSince: logs.length,
    queuePosition,
  };
}

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

export async function claimQueuedJob(jobId: string): Promise<boolean> {
  const { count } = await prisma.job.updateMany({
    where: { id: jobId, status: 'queued' },
    data: { status: 'running', startedAt: new Date(), error: null },
  });
  return count === 1;
}
