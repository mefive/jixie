import type { Prisma } from '@prisma/client';

/**
 * 关联因子报告与 Job 状态，供运行状态读取。
 *
 * Associate factor report and job state for execution queries.
 */
type ExecutionState = {
  legacyStatus: string | null;
  failureMessage: string | null;
  job: { status: string; error: string | null } | null;
};

/**
 * 从报告和关联 Job 推导运行状态，兼容历史无任务终态。
 *
 * Derive report execution state from linked jobs with legacy terminal-state support.
 */
export function factorReportState<Row extends ExecutionState>(row: Row) {
  const status = row.job?.status ?? row.legacyStatus;
  if (!status || !['queued', 'running', 'done', 'error', 'stale'].includes(status)) {
    throw new Error('Invalid historical FactorReport status');
  }
  if (!row.job && (status === 'queued' || status === 'running')) {
    throw new Error('Historical FactorReport has no execution source');
  }
  return {
    ...row,
    status: status === 'queued' ? 'running' : status,
    error: row.job
      ? status === 'error'
        ? (row.failureMessage ?? row.job.error)
        : row.job.error
      : row.failureMessage,
  };
}

export function factorReportStatusWhere(statuses: string[]): Prisma.FactorReportWhereInput {
  const jobStatuses = statuses.includes('running')
    ? [...new Set([...statuses, 'queued'])]
    : statuses;
  return {
    OR: [
      { job: { is: { status: { in: jobStatuses } } } },
      { job: { is: null }, legacyStatus: { in: statuses } },
    ],
  };
}
