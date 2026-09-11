import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '#infra/database/prisma.js';
import { getJob } from '#infra/jobs/records.js';

export const factorJobLogsQuerySchema = z.object({ since: z.string().regex(/^\d+$/).optional() });

type FactorJobTask = 'analysis' | 'correlation';

export function matchesFactorJobTask(
  job: { payload: Prisma.JsonValue; factorReportId: string | null },
  task: FactorJobTask,
) {
  const payload = job.payload;
  const persistedTask =
    payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.task : undefined;

  if (task === 'correlation') {
    return persistedTask === 'correlation' && job.factorReportId === null;
  }

  // Historical analysis jobs can omit the discriminator but must retain their report relation.
  return (
    job.factorReportId !== null && (persistedTask === undefined || persistedTask === 'analysis')
  );
}

export async function readOwnedFactorJob(
  userId: string,
  jobId: string,
  task: FactorJobTask,
  since: number,
) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, userId, kind: 'factor' },
    select: {
      id: true,
      payload: true,
      factorReportId: true,
      factorReport: { select: { userId: true } },
    },
  });

  if (!job || !matchesFactorJobTask(job, task)) {
    return null;
  }
  if (task === 'analysis' && job.factorReport?.userId !== userId) {
    return null;
  }

  return getJob(userId, job.id, since);
}
