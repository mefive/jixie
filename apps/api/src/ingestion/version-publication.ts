import { getApplicationDatabase } from '#infra/database/prisma.js';
import { getMarketDatabase, withMarketDatabase } from '#infra/database/market-database.js';
import {
  acquireMarketLock,
  MarketAccessBusyError,
  acquireMarketVersionLock,
  assertMaintenanceOwner,
  type MarketLock,
} from '#infra/coordination/market-access.js';
import { IngestionError } from './errors.js';
import { marketVersionFile, sealMarketFile, discardMarketFile } from './version-files.js';

/**
 * 在同一事务内移动可见指针并保存凭据；封存期间读者仍可使用上一版本。
 *
 * Move the visible pointer and record its receipt together. Readers retain the previous version during sealing.
 */
export async function publishSealedCandidate(
  id: string,
  operation: string,
  reviewedVersion: string,
  signal?: AbortSignal,
) {
  assertMaintenanceOwner();
  const app = getApplicationDatabase();
  const candidate = await app.marketVersion.findUniqueOrThrow({ where: { id } });
  if (candidate.publishedAt) {
    return candidate;
  }
  if (
    candidate.phase !== 'publishing' ||
    candidate.operation !== operation ||
    candidate.candidateVersion !== reviewedVersion ||
    candidate.activeSlot !== 1
  ) {
    throw new IngestionError('candidate_state_conflict');
  }

  const sealingAt = performance.now();
  console.error('[publication] sealing', { versionId: id });
  const exclusive = await acquireMarketVersionLock(id, false, 120_000);
  try {
    await sealMarketFile(id);
  } finally {
    await exclusive.release();
  }

  const waitingAt = performance.now();
  console.error('[publication] sealed', {
    versionId: id,
    sealMs: Math.round(waitingAt - sealingAt),
  });
  const lock = await acquireMarketLock('market-access', false, 120_000);
  try {
    signal?.throwIfAborted();
    const switchingAt = performance.now();
    const published = await app.$transaction(async (transaction) => {
      const switched = await transaction.marketPublication.updateMany({
        where: {
          key: 'global',
          sequence: candidate.parentSequence,
          selectionVersion: candidate.selectionVersion,
          currentVersionId: candidate.parentVersionId,
        },
        data: {
          previousVersionId: candidate.parentVersionId,
          currentVersionId: id,
          sequence: { increment: 1 },
        },
      });
      if (switched.count !== 1) {
        throw new IngestionError('candidate_baseline_changed');
      }

      return transaction.marketVersion.update({
        where: {
          id,
          operation,
          phase: 'publishing',
          candidateVersion: reviewedVersion,
          activeSlot: 1,
        },
        data: {
          phase: 'published',
          operation: null,
          activeSlot: null,
          publishedAt: new Date(),
          publishedRevision: candidate.parentSequence + 1,
        },
      });
    });
    console.error('[publication] switched', {
      versionId: id,
      revision: published.publishedRevision,
      waitMs: Math.round(switchingAt - waitingAt),
      transactionMs: Math.round(performance.now() - switchingAt),
    });
    return published;
  } finally {
    await lock.release();
  }
}

/**
 * 已发布数据文件回收前，核对持久引用并尝试独占锁。
 *
 * Reclaim published files only after checking durable references and acquiring exclusive ownership.
 */
export async function collectUnusedMarketFiles() {
  assertMaintenanceOwner();
  const app = getApplicationDatabase();
  const pointer = await app.marketPublication.findUniqueOrThrow({ where: { key: 'global' } });
  if (!pointer.currentVersionId) {
    return;
  }
  const versions = await app.marketVersion.findMany({
    where: { phase: 'published', historyVersionId: null, retained: false },
  });
  for (const version of versions) {
    if (version.id === pointer.currentVersionId || version.id === pointer.previousVersionId) {
      continue;
    }
    // 回退后的新分支可能没有旧分支的收据；先证明确有可用的历史读取位置。
    // After rollback, keep a divergent branch if its receipts are absent from the current market.
    const history = await app.marketVersion.findMany({
      where: {
        OR: [{ id: version.id }, { historyVersionId: version.id }],
        isBaseline: false,
        phase: { not: 'rejected' },
      },
      select: { runId: true },
    });
    const covered = await withMarketDatabase(
      marketVersionFile(pointer.currentVersionId),
      'published',
      async () => {
        for (let start = 0; start < history.length; start += 250) {
          const ids = history.slice(start, start + 250).map((entry) => entry.runId);
          if (
            (await getMarketDatabase().ingestionRun.count({ where: { id: { in: ids } } })) !==
            ids.length
          ) {
            return false;
          }
        }
        return true;
      },
    );
    if (!covered) {
      continue;
    }

    const admission = await acquireMarketLock('market-access', false, 120_000);
    try {
      const pending = await app.job.count({
        where: { marketVersionId: version.id, status: { in: ['queued', 'running'] } },
      });
      if (pending) {
        continue;
      }
      let pin: MarketLock;
      try {
        pin = await acquireMarketVersionLock(version.id, false);
      } catch (error) {
        if (error instanceof MarketAccessBusyError) {
          continue;
        }
        throw error;
      }
      try {
        // 先登记历史诊断的存放版本，再移除文件；崩溃最多遗留待清理文件。
        // Redirect historical diagnostics before removing files; a crash can only leave unused files.
        await app.marketVersion.updateMany({
          where: { OR: [{ id: version.id }, { historyVersionId: version.id }] },
          data: { historyVersionId: pointer.currentVersionId },
        });
        await discardMarketFile(version.id);
      } finally {
        await pin.release();
      }
    } finally {
      await admission.release();
    }
  }
}
