import { readMarketSnapshot } from '#infra/database/market-database.js';
import { randomUUID } from 'node:crypto';
import type { MarketVersion } from '@jixie/app-db-client';
import { getApplicationDatabase } from '#infra/database/prisma.js';
import { withMarketDatabase } from '#infra/database/market-database.js';
import {
  acquireMarketLock,
  acquireMarketVersionLock,
  assertMaintenanceOwner,
  type MarketLock,
} from '#infra/coordination/market-access.js';
import { IngestionError } from './errors.js';
import { ingestionExecutionSchema } from './schema.js';
import { marketVersionFile } from './version-files.js';
import { reviewMarketVersion, readMarketTimings } from './version-review.js';
import { publishSealedCandidate, collectUnusedMarketFiles } from './version-publication.js';

const reviewTransaction = { timeout: 120_000 };

export async function withVersionEvidence<Result>(
  runId: string,
  read: (location: 'published' | 'candidate') => Promise<Result>,
) {
  const admission = await acquireMarketLock('market-access', true, 120_000);
  let pin: MarketLock | undefined;
  try {
    let fileId: string;
    let location: 'published' | 'candidate';
    try {
      const version = await getApplicationDatabase().marketVersion.findUnique({ where: { runId } });
      if (!version || version.phase === 'rejected' || (version.activeSlot && !version.readyAt)) {
        throw new IngestionError('export_run_not_found');
      }
      fileId = version.historyVersionId ?? version.id;
      location = version.activeSlot ? 'candidate' : 'published';
      pin = await acquireMarketVersionLock(fileId, true, 120_000);
    } finally {
      await admission.release();
    }

    return await withMarketDatabase(
      marketVersionFile(fileId),
      location === 'candidate' ? 'review' : 'published',
      () => read(location),
    );
  } finally {
    await pin?.release();
  }
}

export async function inspectMarketVersion(version: MarketVersion, includeTimings: boolean) {
  if (version.phase === 'rejected' || (!version.readyAt && version.activeSlot === 1)) {
    return {
      runId: version.runId,
      targetDate: version.targetDate,
      phase: version.phase,
      status: version.phase,
      pending: undefined,
      finishedAt: version.finishedAt?.toISOString() ?? null,
      startedAt: version.createdAt.toISOString(),
      rejectionReason: version.rejectionReason,
      ...(includeTimings ? { batches: [] } : {}),
    };
  }
  return withVersionEvidence(version.runId, async () => {
    return readMarketSnapshot(async (transaction) => {
      const review = await reviewMarketVersion(transaction, version.runId);
      const execution = ingestionExecutionSchema.safeParse(review.run.summary);
      const timings = includeTimings ? await readMarketTimings(transaction, version.runId) : {};

      return {
        runId: version.runId,
        targetDate: review.run.targetDate,
        phase: version.phase,
        status: review.run.status,
        finishedAt: review.run.finishedAt?.toISOString() ?? null,
        startedAt: review.run.startedAt.toISOString(),
        publishedAt: version.publishedAt,
        publishedRevision: version.publishedRevision,
        pending: review.pending,
        candidateVersion: review.candidateVersion,
        execution: execution.success ? execution.data : null,
        ...timings,
      };
    }, reviewTransaction);
  });
}

/**
 * 从版本文件重核实际诊断，再以审核版本与执行权切换指针。
 *
 * Recheck actual diagnostics and publish under the reviewed version and claim.
 */
export async function acceptMarketVersion(
  version: MarketVersion,
  expected?: string,
  signal?: AbortSignal,
) {
  assertMaintenanceOwner();
  const runId = version.runId;
  if (version.publishedAt) {
    return {
      mode: 'already_published' as const,
      runId,
      revision: version.publishedRevision,
      cleaned: true,
    };
  }
  if (version.phase !== 'awaiting_publish' || version.activeSlot !== 1 || version.operation) {
    throw new IngestionError('candidate_state_conflict');
  }

  const app = getApplicationDatabase();
  const review = await withMarketDatabase(marketVersionFile(version.id), 'review', () =>
    readMarketSnapshot((transaction) => reviewMarketVersion(transaction, runId), reviewTransaction),
  );
  if (
    review.phase !== 'awaiting_publish' ||
    (expected !== undefined && review.candidateVersion !== expected)
  ) {
    throw new IngestionError('candidate_state_conflict');
  }
  signal?.throwIfAborted();

  const operation = randomUUID();
  const claim = await app.marketVersion.updateMany({
    where: { id: version.id, phase: 'awaiting_publish', activeSlot: 1, operation: null },
    data: { phase: 'publishing', operation, candidateVersion: review.candidateVersion },
  });
  if (claim.count !== 1) {
    throw new IngestionError('candidate_state_conflict');
  }

  try {
    const published = await publishSealedCandidate(
      version.id,
      operation,
      review.candidateVersion,
      signal,
    );
    let cleaned = true;
    try {
      await collectUnusedMarketFiles();
    } catch (error) {
      cleaned = false;
      console.warn('[market] version cleanup deferred', error);
    }
    return { mode: 'published' as const, runId, revision: published.publishedRevision, cleaned };
  } catch (error) {
    await app.marketVersion.updateMany({
      where: { id: version.id, operation, publishedAt: null },
      data: { phase: 'awaiting_publish', operation: null },
    });
    throw error;
  }
}
