import type { Prisma } from '@prisma/client';
import prismaPackage from '@prisma/client';
const { Prisma: sqlPrisma } = prismaPackage;
import { prisma } from '#infra/database/prisma.js';

export const currentSignalJob = {
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  take: 1,
} satisfies Prisma.JobFindManyArgs;

/**
 * 关联信号尝试、任务与执行状态，供结果读取与重试校验。
 *
 * Associate signal attempts, jobs and execution state for reads and retries.
 */
type SignalExecutionState = {
  legacyStatus: string | null;
  legacyError: string | null;
  jobs: Array<{ id: string; status: string; error: string | null }>;
};

/**
 * 从持久化运行与任务派生对外状态，兼容历史终态记录。
 *
 * Derive public signal state from persisted runs and jobs, including legacy terminal records.
 */
export function signalRunState<Row extends SignalExecutionState>(row: Row) {
  const job = row.jobs[0];
  const status = job?.status ?? row.legacyStatus;
  if (!status || !['queued', 'running', 'done', 'error', 'stale'].includes(status)) {
    throw new Error('Invalid historical SignalRun status');
  }
  if (!job && (status === 'queued' || status === 'running')) {
    throw new Error('Historical SignalRun has no execution source');
  }
  return {
    ...row,
    status: status === 'queued' ? 'running' : status,
    error: job ? job.error : row.legacyError,
  };
}

/**
 * 使用尝试身份限制提交后元数据更新，防止覆盖更新的重试。
 *
 * Guard post-commit metadata against a retry that superseded this attempt.
 */
export function signalAttemptWhere(
  job: { id: string; createdAt: Date } | undefined,
): Prisma.SignalRunWhereInput {
  if (!job) {
    return { jobs: { none: {} } };
  }
  return {
    AND: [
      { jobs: { some: { id: job.id } } },
      {
        jobs: {
          none: {
            OR: [
              { createdAt: { gt: job.createdAt } },
              { createdAt: job.createdAt, id: { gt: job.id } },
            ],
          },
        },
      },
    ],
  };
}

/**
 * 使用已批准的 SQL 例外比较同级尝试时间戳，解析已完成信号运行。
 *
 * Approved SQL exception: Prisma relation filters cannot compare sibling attempt timestamps.
 */
export async function completedSignalRunIds(input: {
  deploymentId?: string;
  throughDate?: string;
  afterDate?: string;
}): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(sqlPrisma.sql`
    SELECT run.id FROM SignalRun AS run
    WHERE ${input.deploymentId === undefined ? sqlPrisma.sql`1 = 1` : sqlPrisma.sql`run.deploymentId = ${input.deploymentId}`}
      AND ${input.throughDate === undefined ? sqlPrisma.sql`1 = 1` : sqlPrisma.sql`run.execDate <= ${input.throughDate}`}
      AND ${input.afterDate === undefined ? sqlPrisma.sql`1 = 1` : sqlPrisma.sql`run.execDate > ${input.afterDate}`}
      AND (
        EXISTS (
          SELECT 1 FROM Job AS attempt
          WHERE attempt.signalRunId = run.id AND attempt.status = 'done'
            AND NOT EXISTS (
              SELECT 1 FROM Job AS newer
              WHERE newer.signalRunId = run.id AND (
                newer.createdAt > attempt.createdAt OR
                (newer.createdAt = attempt.createdAt AND newer.id > attempt.id)
              )
            )
        ) OR (
          run.status = 'done' AND NOT EXISTS (SELECT 1 FROM Job WHERE Job.signalRunId = run.id)
        )
      )
  `);
  return rows.map((row) => row.id);
}
