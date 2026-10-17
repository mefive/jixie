import type { Job, Prisma } from '@prisma/client';
import type { LogWriter } from './job-logs.js';

/**
 * 定义业务任务钩子；JobService 统一拥有状态转换与事务边界。
 * Business hooks; JobService owns status transitions and transaction boundaries.
 */
export interface JobLifecycle<Result> {
  onExecute(job: Job, log: LogWriter): Promise<Result>;
  onSuccess?(transaction: Prisma.TransactionClient, job: Job, result: Result): Promise<void>;
  onFailure?(transaction: Prisma.TransactionClient, job: Job, error: unknown): Promise<void>;
  onInterrupted?(transaction: Prisma.TransactionClient, job: Job): Promise<void>;
  /** Runs after commit; failures never rewrite the committed Job status. */
  onCommitted?(job: Job, status: 'done' | 'error'): Promise<void>;
}
