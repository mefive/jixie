import type { Prisma } from '@prisma/client';

/**
 * 关联回测报告与任务状态，供运行和历史结果查询。
 * Associate backtest reports and job state for execution and history queries.
 */
type ExecutionState = {
  legacyStatus: string | null;
  legacyError: string | null;
  job: { status: string; error: string | null } | null;
};

/**
 * 从报告和关联任务派生回测状态，兼容无任务历史结果。
 * Derive backtest report state from linked jobs with legacy-result compatibility.
 */
export function backtestReportState<Row extends ExecutionState>(row: Row) {
  const status = row.job?.status ?? row.legacyStatus;
  if (!status || !['queued', 'running', 'done', 'error', 'stale'].includes(status)) {
    throw new Error('Invalid historical BacktestReport status');
  }
  if (!row.job && (status === 'queued' || status === 'running')) {
    throw new Error('Historical BacktestReport has no execution source');
  }
  return {
    ...row,
    status: status === 'queued' ? 'running' : status,
    error: row.job ? row.job.error : row.legacyError,
  };
}

export function backtestReportStatusWhere(statuses: string[]): Prisma.BacktestReportWhereInput {
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
