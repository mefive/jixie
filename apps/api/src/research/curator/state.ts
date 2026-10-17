import type { Prisma } from '@prisma/client';

/**
 * 关联整理运行与 Job 状态，供恢复及查询。
 * Associate curator runs and jobs for recovery and queries.
 */
type ExecutionState = {
  legacyStatus: string | null;
  legacyError: string | null;
  job: { status: string; error: string | null } | null;
};

/**
 * 从整理报告和任务派生运行状态，兼容历史终态。
 * Derive curator execution state from its report and job with legacy support.
 */
export function researchCuratorRunState<Row extends ExecutionState>(row: Row) {
  const status = row.job?.status ?? row.legacyStatus;
  if (!status || !['queued', 'running', 'done', 'error', 'stale'].includes(status)) {
    throw new Error('Invalid historical ResearchCuratorRun status');
  }
  if (!row.job && (status === 'queued' || status === 'running')) {
    throw new Error('Historical ResearchCuratorRun has no execution source');
  }
  return { ...row, status: status, error: row.job ? row.job.error : row.legacyError };
}

export function researchCuratorRunStatusWhere(
  statuses: string[],
): Prisma.ResearchCuratorRunWhereInput {
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
