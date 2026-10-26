import type { Prisma } from '@prisma/client';
import { ACTIVE_JOB_STATUSES } from '#jobs/job-service.js';

interface FactorReportScope {
  userId: string;
  factor: string;
}

/**
 * 保留每个用户和因子的最新分析、活动任务与发布绑定；在调用方事务内清理其他报告和级联日志。
 *
 * Keep each user's latest analysis per factor, active tasks and publication links; prune other
 * reports and cascading job logs within the caller's transaction.
 */
export async function pruneFactorReports(
  transaction: Prisma.TransactionClient,
  scope?: FactorReportScope,
): Promise<number> {
  const rows = await transaction.factorReport.findMany({
    where: scope,
    select: {
      id: true,
      userId: true,
      factor: true,
      approvedFactor: { select: { id: true } },
      job: { select: { status: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const seen = new Map<string, Set<string>>();
  const obsolete: string[] = [];

  for (const row of rows) {
    const factors = seen.get(row.userId) ?? new Set<string>();
    const latest = !factors.has(row.factor);
    factors.add(row.factor);
    seen.set(row.userId, factors);

    if (
      latest ||
      row.approvedFactor ||
      (row.job && ACTIVE_JOB_STATUSES.includes(row.job.status as 'queued' | 'running'))
    ) {
      continue;
    }
    obsolete.push(row.id);
  }

  let deleted = 0;
  for (let offset = 0; offset < obsolete.length; offset += 128) {
    const result = await transaction.factorReport.deleteMany({
      where: {
        id: { in: obsolete.slice(offset, offset + 128) },
        approvedFactor: { is: null },
        OR: [{ job: { is: null } }, { job: { is: { status: { notIn: ['queued', 'running'] } } } }],
      },
    });
    deleted += result.count;
  }

  return deleted;
}
