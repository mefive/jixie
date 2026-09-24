import type { Prisma } from '@prisma/client';
import prismaPackage from '@prisma/client';
const { Prisma: sqlPrisma } = prismaPackage;
import { prisma } from '#infra/database/prisma.js';

export const currentSignalJob = {
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  take: 1,
} satisfies Prisma.JobFindManyArgs;

type SignalExecutionState = {
  legacyStatus: string | null;
  legacyError: string | null;
  jobs: Array<{ id: string; status: string; error: string | null }>;
};

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

/** Guard post-commit metadata against a retry that superseded this attempt. */
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

/** Approved SQL exception: Prisma relation filters cannot compare sibling attempt timestamps. */
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
