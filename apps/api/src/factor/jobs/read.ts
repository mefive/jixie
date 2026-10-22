import { getDatabase } from '#infra/database/prisma.js';
import { JobService, type JobKind } from '#jobs/job-service.js';

/**
 * 校验用户对因子任务及关联来源的访问权限。
 *
 * Authorize a factor job and its associated source for a user.
 */
export async function readOwnedFactorJob(
  userId: string,
  jobId: string,
  kind: Extract<JobKind, 'factor-analysis' | 'factor-correlation'>,
  since: number,
) {
  const job = await getDatabase().job.findFirst({
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

  return job ? JobService.get(userId, job.id, since) : null;
}
