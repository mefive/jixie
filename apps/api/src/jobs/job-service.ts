import {
  acquireMarketScope,
  acquireWorkOwner,
  MarketAccessBusyError,
  type MarketReaderScope,
  type MarketLock,
} from '#infra/coordination/market-access.js';
import { ulid } from 'ulid';
import type { Job, Prisma } from '@prisma/client';
import { getDatabase } from '#infra/database/prisma.js';
import { JobLogs } from './job-logs.js';
import type { JobLifecycle } from './lifecycle.js';

/**
 * 限定已注册任务的业务种类，供生命周期分派。
 *
 * Identify registered business job kinds for lifecycle dispatch.
 */
export type JobKind =
  | 'backtest'
  | 'factor-analysis'
  | 'factor-correlation'
  | 'strategy-scan'
  | 'signal'
  | 'research-curator'
  | 'research-embedded-analysis';

/**
 * 定义任务持久化状态，供提交、执行和终态恢复共用。
 *
 * Define persisted job states shared by submission, execution and recovery.
 */
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'stale';

export type ActiveJobStatus = Extract<JobStatus, 'queued' | 'running'>;

export const ACTIVE_JOB_STATUSES: ActiveJobStatus[] = ['queued', 'running'];

export type { Job } from '@prisma/client';
type JobRelation = Exclude<Extract<keyof Job, `${string}Id`>, 'userId'>;

export class JobService {
  private static readonly lifecycles = new Map<string, JobLifecycle<unknown>>();
  private static readonly relations = new Map<JobRelation, JobLifecycle<unknown>>();
  private static readonly claims = new Map<
    string,
    { reader: MarketReaderScope; owner: MarketLock }
  >();
  private constructor() {}

  /**
   * 登记业务生命周期处理器，供任务执行按 kind 分派。
   *
   * Register a business lifecycle handler for dispatch by job kind.
   */
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
    await getDatabase().job.create({ data: { id, userId, kind, key, status: 'queued', payload } });
    return id;
  }

  /**
   * 读取任务及相关业务归属，供查询与生命周期管理。
   *
   * Read a job and its business association for status and lifecycle handling.
   */
  static async get(userId: string, jobId: string, since = 0) {
    const job = await getDatabase().job.findFirst({ where: { id: jobId, userId } });
    if (!job) {
      return null;
    }
    const logs = JobLogs.read(jobId, job.logs);
    const queuePosition =
      job.status === 'queued'
        ? await getDatabase().job.count({
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
    const reader = await acquireMarketScope();
    let owner: MarketLock | undefined;
    let claimed = false;
    try {
      try {
        owner = await acquireWorkOwner('job', jobId);
      } catch (error) {
        if (error instanceof MarketAccessBusyError) {
          return false;
        }
        throw error;
      }
      const { count } = await getDatabase().job.updateMany({
        where: { id: jobId, status: 'queued' },
        data: { status: 'running', startedAt: new Date(), error: null },
      });
      claimed = count === 1;
      if (claimed) {
        JobService.claims.set(jobId, { reader, owner });
      }
      return claimed;
    } finally {
      if (!claimed) {
        try {
          await owner?.release();
        } finally {
          await reader.release();
        }
      }
    }
  }

  /**
   * 观察任务直到终态；不会派发工作或恢复其他消费者的任务。
   *
   * This observer does not dispatch work or recover another consumer's tasks.
   */
  static async waitForCompletion(
    jobId: string,
  ): Promise<Extract<JobStatus, 'done' | 'error' | 'stale'>> {
    for (;;) {
      const job = await getDatabase().job.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (!job || job.status === 'error' || job.status === 'stale') {
        return job?.status === 'stale' ? 'stale' : 'error';
      }
      if (job.status === 'done') {
        return 'done';
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  /**
   * 在统一生命周期内执行计算，并通过终态事务写入业务结果及任务状态。
   *
   * Run job computation and commit business results and terminal job state through the lifecycle transaction.
   */
  static async execute(jobId: string): Promise<void> {
    const claim = JobService.claims.get(jobId);
    if (!claim) {
      throw new Error('Job execution requires a locally owned claim');
    }
    try {
      await claim.reader.run(() => JobService.executeOwned(jobId));
    } finally {
      JobService.claims.delete(jobId);
      try {
        await claim.owner.release();
      } finally {
        await claim.reader.release();
      }
    }
  }

  private static async executeOwned(jobId: string): Promise<void> {
    const job = await getDatabase().job.findUnique({ where: { id: jobId } });
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
    const jobs = await getDatabase().job.findMany({ where: { status: 'running' } });
    let count = 0;
    for (const job of jobs) {
      let owner: MarketLock;
      try {
        owner = await acquireWorkOwner('job', job.id);
      } catch (error) {
        if (error instanceof MarketAccessBusyError) {
          continue;
        }
        throw error;
      }
      try {
        count += await getDatabase().$transaction(async (transaction) => {
          const claimed = await transaction.job.updateMany({
            where: { id: job.id, status: 'running' },
            data: { status: 'stale', finishedAt: new Date() },
          });
          if (!claimed.count) {
            return 0;
          }
          for (const lifecycle of JobService.relatedLifecycles(job)) {
            await lifecycle.onInterrupted?.(transaction, job);
          }
          return 1;
        });
      } finally {
        await owner.release();
      }
    }
    return count;
  }

  private static async complete(
    job: Job,
    lifecycle: JobLifecycle<unknown>,
    result: unknown,
  ): Promise<boolean> {
    const logs = JobLogs.snapshot(job.id);
    const committed = await getDatabase().$transaction(async (transaction) => {
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

  /**
   * 通过任务失败生命周期提交错误和业务终态，避免残留运行状态。
   *
   * Finalize job failure through business lifecycle and terminal state handling.
   */
  private static async fail(job: Job, error: unknown): Promise<boolean> {
    const logs = JobLogs.snapshot(job.id);
    const message = error instanceof Error ? error.message : String(error);
    const committed = await getDatabase().$transaction(async (transaction) => {
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

  /**
   * 查找与业务实体关联的生命周期处理器，供任务管理共用。
   *
   * Resolve lifecycle handlers associated with a business entity.
   */
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
