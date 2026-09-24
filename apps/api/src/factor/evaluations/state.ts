import type { Prisma } from '@prisma/client';

type ExecutionState = {
  legacyStatus: string | null;
  failureMessage: string | null;
  job: { status: string; error: string | null } | null;
};

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
