import { getDatabase } from '#infra/database/prisma.js';
import { unitKey } from './runs.js';

/**
 * 保留最近运行明细和恢复必需的成功收据，所有问题及关联批次始终保留。
 *
 * Retain recent detail and successful recovery receipts; never remove issues or their batches.
 */
export async function compactSuccessfulReceipts(): Promise<number> {
  const database = getDatabase();
  const recent = await database.ingestionRun.findMany({
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: 20,
    select: { id: true },
  });
  const protectedRuns = new Set(recent.map((run) => run.id));
  const unfinished = await database.ingestionRun.findMany({
    where: { status: { not: 'completed' } },
    select: { id: true },
  });
  for (const run of unfinished) {
    protectedRuns.add(run.id);
  }
  const receipts = await database.ingestionBatch.findMany({
    where: { status: 'succeeded' },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      runId: true,
      dataset: true,
      scope: true,
      period: true,
      rangeStart: true,
      rangeEnd: true,
      sourceStart: true,
    },
  });
  // 保留同轮问题对应的较新收据，防止压缩后把被替代的问题重新列为待办。
  // Keep newer receipts for diagnosed units in the same run so compaction cannot reopen old issues.
  const diagnosed = await database.ingestionBatch.findMany({
    where: { issues: { some: {} } },
    select: { runId: true, dataset: true, scope: true, period: true },
    distinct: ['runId', 'dataset', 'scope', 'period'],
  });
  const diagnosedUnits = new Set(
    diagnosed.map((batch) => JSON.stringify([batch.runId, unitKey(batch)])),
  );
  const retained = new Map<string, typeof receipts>();
  const obsolete: string[] = [];
  for (const receipt of receipts) {
    const key = JSON.stringify([receipt.dataset, receipt.scope, receipt.period]);
    const newer = retained.get(key) ?? [];
    const covered = newer.some((candidate) => {
      if (
        receipt.sourceStart &&
        (!candidate.sourceStart || candidate.sourceStart > receipt.sourceStart)
      ) {
        return false;
      }
      if (receipt.period === 'snapshot' || receipt.period === 'all') {
        return true;
      }

      return (
        candidate.rangeStart &&
        candidate.rangeEnd &&
        receipt.rangeStart &&
        receipt.rangeEnd &&
        candidate.rangeStart <= receipt.rangeStart &&
        candidate.rangeEnd >= receipt.rangeEnd
      );
    });
    if (
      !protectedRuns.has(receipt.runId) &&
      !diagnosedUnits.has(JSON.stringify([receipt.runId, unitKey(receipt)])) &&
      covered
    ) {
      obsolete.push(receipt.id);
    } else {
      newer.push(receipt);
      retained.set(key, newer);
    }
  }
  let deleted = 0;
  for (let offset = 0; offset < obsolete.length; offset += 500) {
    deleted += (
      await database.ingestionBatch.deleteMany({
        where: { id: { in: obsolete.slice(offset, offset + 500) }, issues: { none: {} } },
      })
    ).count;
  }

  return deleted;
}
