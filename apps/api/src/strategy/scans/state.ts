import type { Prisma } from '@prisma/client';

type ExecutionState = {
  legacyStatus: string | null;
  legacyError: string | null;
  job: { status: string; error: string | null } | null;
};

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
