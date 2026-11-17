import { sourceExecution } from '#market/synchronization/execution.js';
import type { Prisma } from '@jixie/market-db-client';
import { fingerprint } from '#market/synchronization/rows.js';
import { readRunIssueState } from './issue-state.js';
import { readIssueHandling } from './resolutions.js';

/**
 * 直接从版本文件计算当前审核结论。
 *
 * Calculate review eligibility from the version file.
 */
export async function reviewMarketVersion(transaction: Prisma.TransactionClient, runId: string) {
  const state = await readRunIssueState(transaction, runId);
  const market = await transaction.marketDataState.findUnique({ where: { key: 'global' } });
  const decisions = [];
  let pending = 0;
  for (const item of state.active) {
    const handling = await readIssueHandling(transaction, item);
    if (handling.status === 'pending' || handling.status === 'review') {
      pending++;
    }
    decisions.push({ id: item.issue.id, handling, version: item.resolution?.updatedAt });
  }
  const phase = ['completed', 'completed_with_issues'].includes(state.run.status)
    ? pending
      ? 'awaiting_repair'
      : 'awaiting_publish'
    : 'interrupted';

  return {
    run: state.run,
    phase,
    pending,
    candidateVersion: fingerprint({ runId, market, decisions, finishedAt: state.run.finishedAt }),
  };
}
export async function readMarketTimings(database: Prisma.TransactionClient, runId: string) {
  const { startedAt, finishedAt, batches } = await database.ingestionRun.findUniqueOrThrow({
    where: { id: runId },
    select: {
      startedAt: true,
      finishedAt: true,
      batches: {
        select: {
          id: true,
          request: true,
          dataset: true,
          scope: true,
          period: true,
          api: true,
          rangeStart: true,
          rangeEnd: true,
          status: true,
          startedAt: true,
          finishedAt: true,
        },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      },
    },
  });

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt?.toISOString() ?? null,
    batches: batches.map(({ request, ...batch }) => ({
      ...batch,
      execution: sourceExecution(request),
      elapsedMs: batch.finishedAt ? batch.finishedAt.getTime() - batch.startedAt.getTime() : null,
    })),
  };
}
