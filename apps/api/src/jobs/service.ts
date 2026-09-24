import { ulid } from 'ulid';
import type { Job, Prisma } from '@prisma/client';
import { prisma } from '#infra/database/prisma.js';
import { JobLogs } from './logs.js';
import type { JobLifecycle } from './lifecycle.js';

export type JobKind =
  | 'backtest'
  | 'factor-analysis'
  | 'factor-correlation'
  | 'strategy-scan'
  | 'signal'
  | 'research-curator'
  | 'research-embedded-analysis';

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'stale';

export type ActiveJobStatus = Extract<JobStatus, 'queued' | 'running'>;

export const ACTIVE_JOB_STATUSES: ActiveJobStatus[] = ['queued', 'running'];

export type { Job } from '@prisma/client';
type JobRelation = Exclude<Extract<keyof Job, `${string}Id`>, 'userId'>;

export class JobService {
  private static readonly lifecycles = new Map<string, JobLifecycle<unknown>>();
  private static readonly relations = new Map<JobRelation, JobLifecycle<unknown>>();
  private constructor() {}

  static register<Result>(
    kind: JobKind,
    lifecycle: JobLifecycle<Result>,
    relation?: JobRelation,
  ): void {
    const existing = JobService.lifecycles.get(kind);
    if (existing && existing !== lifecycle) {
      throw new Error(`Job lifecycle already registered: ${kind}`);
    }
    const related = relation && JobService.relations.get(relation);
    if (related && related !== lifecycle) {
      throw new Error(`Job relation already registered: ${relation}`);
    }
    JobService.lifecycles.set(kind, lifecycle);
    if (relation) {
      JobService.relations.set(relation, lifecycle);
    }
  }

  static async create(
    userId: string,
    kind: JobKind,
    key: string,
    payload: Prisma.InputJsonValue,
  ): Promise<string> {
    const id = ulid();
    await prisma.job.create({ data: { id, userId, kind, key, status: 'queued', payload } });
    return id;
  }

  static async get(userId: string, jobId: string, since = 0) {
    const job = await prisma.job.findFirst({ where: { id: jobId, userId } });
    if (!job) {
      return null;
    }
    const logs = JobLogs.read(jobId, job.logs);
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

  static async claim(jobId: string): Promise<boolean> {
    const { count } = await prisma.job.updateMany({
      where: { id: jobId, status: 'queued' },
      data: { status: 'running', startedAt: new Date(), error: null },
    });
    return count === 1;
  }

  /** This observer does not dispatch work or recover another consumer's tasks. */
  static async waitForCompletion(
    jobId: string,
  ): Promise<Extract<JobStatus, 'done' | 'error' | 'stale'>> {
    for (;;) {
      const job = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
      if (!job || job.status === 'error' || job.status === 'stale') {
        return job?.status === 'stale' ? 'stale' : 'error';
      }
      if (job.status === 'done') {
        return 'done';
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  static async execute(jobId: string): Promise<void> {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'running') {
      return;
    }
    JobLogs.initialize(job.id);
    let committed: boolean;
    try {
      const lifecycle = JobService.lifecycles.get(job.kind);
      if (!lifecycle) {
        throw new Error(`Unsupported queued job kind: ${job.kind}`);
      }
      const result = await lifecycle.onExecute(job, (entry) => JobLogs.append(job.id, entry));
      committed = await JobService.complete(job, lifecycle, result);
    } catch (error) {
      try {
        committed = await JobService.fail(job, error);
      } catch (failureError) {
        throw new AggregateError(
          [error, failureError],
          'Job execution and failure persistence failed',
        );
      }
      if (committed) {
        await JobService.notifyCommitted(job, 'error');
      }
      return;
    }
    if (committed) {
      await JobService.notifyCommitted(job, 'done');
    }
  }

  static async recoverInterrupted(): Promise<number> {
    return prisma.$transaction(async (transaction) => {
      const jobs = await transaction.job.findMany({ where: { status: 'running' } });
      let count = 0;
      for (const job of jobs) {
        const claimed = await transaction.job.updateMany({
          where: { id: job.id, status: 'running' },
          data: { status: 'stale', finishedAt: new Date() },
        });
        if (claimed.count !== 1) {
          continue;
        }
        for (const lifecycle of JobService.relatedLifecycles(job)) {
          await lifecycle.onInterrupted?.(transaction, job);
        }
        count++;
      }
      return count;
    });
  }

  private static async complete(
    job: Job,
    lifecycle: JobLifecycle<unknown>,
    result: unknown,
  ): Promise<boolean> {
    const logs = JobLogs.snapshot(job.id);
    const committed = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.job.updateMany({
        where: { id: job.id, status: 'running' },
        data: { status: 'done', error: null, finishedAt: new Date(), logs },
      });
      if (claimed.count !== 1) {
        return false;
      }
      await lifecycle.onSuccess?.(transaction, job, result);
      return true;
    });
    if (committed) {
      JobLogs.freeze(job.id, logs);
    }
    return committed;
  }

  private static async fail(job: Job, error: unknown): Promise<boolean> {
    const logs = JobLogs.snapshot(job.id);
    const message = error instanceof Error ? error.message : String(error);
    const committed = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.job.updateMany({
        where: { id: job.id, status: 'running' },
        data: { status: 'error', error: message, finishedAt: new Date(), logs },
      });
      if (claimed.count !== 1) {
        return false;
      }
      for (const lifecycle of JobService.relatedLifecycles(job)) {
        await lifecycle.onFailure?.(transaction, job, error);
      }
      return true;
    });
    if (committed) {
      JobLogs.freeze(job.id, logs);
    }
    return committed;
  }

  // Persisted links still need cleanup when kind or payload is corrupt.
  private static relatedLifecycles(job: Job): Set<JobLifecycle<unknown>> {
    const lifecycles = new Set<JobLifecycle<unknown>>();
    const selected = JobService.lifecycles.get(job.kind);
    if (selected) {
      lifecycles.add(selected);
    }
    for (const [relation, lifecycle] of JobService.relations) {
      if (job[relation]) {
        lifecycles.add(lifecycle);
      }
    }
    return lifecycles;
  }

  private static async notifyCommitted(job: Job, status: 'done' | 'error'): Promise<void> {
    for (const lifecycle of JobService.relatedLifecycles(job)) {
      try {
        await lifecycle.onCommitted?.(job, status);
      } catch (error) {
        console.error('[jixie] job post-commit action failed', { jobId: job.id, error });
      }
    }
  }
}
