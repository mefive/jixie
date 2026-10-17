import type { Prisma } from '@prisma/client';

/**
 * 关联策略扫描任务与报告状态，供运行及历史查询。
 *
 * Associate strategy scan jobs and report state for execution and history queries.
 */
type ExecutionState = {
  legacyStatus: string | null;
  legacyError: string | null;
  job: { status: string; error: string | null } | null;
};

/**
 * 从报告和任务派生扫描状态，兼容历史已完成报告。
 *
 * Derive scan report state from its job with legacy terminal-result support.
 */
export function strategyScanReportState<Row extends ExecutionState>(row: Row) {
  const status = row.job?.status ?? row.legacyStatus;
  if (!status || !['queued', 'running', 'done', 'error', 'stale'].includes(status)) {
    throw new Error('Invalid historical StrategyScanReport status');
  }
  if (!row.job && (status === 'queued' || status === 'running')) {
    throw new Error('Historical StrategyScanReport has no execution source');
  }
  return {
    ...row,
    status: status === 'queued' ? 'running' : status,
    error: row.job ? row.job.error : row.legacyError,
  };
}

export function strategyScanReportStatusWhere(
  statuses: string[],
): Prisma.StrategyScanReportWhereInput {
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
