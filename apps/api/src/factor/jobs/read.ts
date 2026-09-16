import { prisma } from '#infra/database/prisma.js';
import { getJob, type JobKind } from '#infra/jobs/records.js';

export async function readOwnedFactorJob(
  userId: string,
  jobId: string,
  kind: Extract<JobKind, 'factor-analysis' | 'factor-correlation'>,
  since: number,
) {
  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      userId,
      kind,
      ...(kind === 'factor-analysis'
        ? { factorReport: { is: { userId } } }
        : { factorReportId: null }),
    },
    select: { id: true },
  });

  return job ? getJob(userId, job.id, since) : null;
}
