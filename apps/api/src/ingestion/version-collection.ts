import { OWNER_READ_WRITE } from '#infra/file-permissions.js';
import { readMarketSnapshot } from '#infra/database/market-database.js';
import { DEFAULT_INDEX_DOWNLOADS } from '#market/downloads/lists.js';
import { configuredSelection } from '#market/downloads/version-selection.js';
import { chmod } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ulid } from 'ulid';
import type { MarketVersion } from '@jixie/app-db-client';
import { withMaintenanceLock } from '#infra/coordination/market-access.js';
import { getApplicationDatabase } from '#infra/database/prisma.js';
import { getCandidateDatabase, withMarketDatabase } from '#infra/database/market-database.js';
import { IngestionError } from './errors.js';
import { collectInReplica } from './ingest.js';
import {
  cloneMarketFile,
  createEmptyMarketFile,
  discardMarketFile,
  marketVersionFile,
} from './version-files.js';
import { reviewMarketVersion } from './version-review.js';
import type { IngestionInput } from './schema.js';

async function finalize(version: MarketVersion, operation: string) {
  const review = await withMarketDatabase(marketVersionFile(version.id), 'review', () =>
    readMarketSnapshot((tx) => reviewMarketVersion(tx, version.runId), {
      timeout: 120_000,
    }),
  );
  await getApplicationDatabase().marketVersion.update({
    where: { id: version.id, operation },
    data: {
      phase: review.phase,
      operation: null,
      candidateVersion: review.candidateVersion,
      finishedAt: review.run.finishedAt,
    },
  });

  return review;
}

export async function collectMarketVersion(
  input: IngestionInput,
  explicitTarget: boolean,
  retryRunId?: string,
) {
  return withMaintenanceLock(async () => {
    const app = getApplicationDatabase();
    const publication = await app.marketPublication.findUniqueOrThrow({ where: { key: 'global' } });
    const active = await app.marketVersion.findUnique({ where: { activeSlot: 1 } });
    if (
      (retryRunId && active?.runId !== retryRunId) ||
      (active && explicitTarget && input.targetDate !== active.targetDate)
    ) {
      throw new IngestionError('candidate_state_conflict');
    }
    if (
      active &&
      (active.operation ||
        !(active.phase === 'interrupted' || (retryRunId && active.phase === 'awaiting_repair')))
    ) {
      if (retryRunId) {
        throw new IngestionError('candidate_state_conflict');
      }
      return {
        mode: 'existing_candidate' as const,
        runId: active.runId,
        targetDate: active.targetDate,
        phase: active.phase,
      };
    }

    const operation = randomUUID();
    const id = active?.id ?? ulid();
    const version = active
      ? await app.marketVersion.update({
          where: { id, operation: null, activeSlot: 1, phase: active.phase },
          data: { phase: 'running', operation },
        })
      : await app.marketVersion.create({
          data: {
            id,
            runId: id,
            phase: 'running',
            operation,
            activeSlot: 1,
            targetDate: input.targetDate,
            trigger: input.trigger ?? 'manual',
            selectionVersion: publication.selectionVersion,
            parentSequence: publication.sequence,
            parentVersionId: publication.currentVersionId,
          },
        });

    try {
      if (!version.readyAt) {
        if (
          version.parentVersionId !== publication.currentVersionId ||
          version.selectionVersion !== publication.selectionVersion ||
          version.parentSequence !== publication.sequence
        ) {
          throw new IngestionError('candidate_baseline_changed');
        }
        if (active) {
          await discardMarketFile(id);
        }
        if (version.parentVersionId) {
          const cloningAt = performance.now();
          const cloned = await cloneMarketFile(version.parentVersionId, id);
          console.error('[ingestion] cloned market parent', {
            id,
            ...cloned,
            elapsedMs: Math.round(performance.now() - cloningAt),
          });
        } else {
          await createEmptyMarketFile(id);
        }
        await withMarketDatabase(marketVersionFile(id), 'candidate', async () => {
          const market = getCandidateDatabase();
          for (const assetType of ['index', 'etf'] as const) {
            const defaults =
              assetType === 'index' ? DEFAULT_INDEX_DOWNLOADS.map((row) => row.tsCode) : [];
            const selection = await configuredSelection(assetType, defaults);
            await market.ingestionSelection.upsert({
              where: { assetType },
              create: { assetType, codes: selection.codes },
              update: { codes: selection.codes },
            });
          }
          await market.ingestionRun.create({
            data: {
              id: version.runId,
              targetDate: version.targetDate,
              trigger: version.trigger,
              scopeSnapshot: {},
              status: 'running',
              startedAt: version.createdAt,
            },
          });
          await market.marketDataState.upsert({
            where: { key: 'global' },
            create: { key: 'global' },
            update: {},
          });
        });
        await app.marketVersion.update({ where: { id, operation }, data: { readyAt: new Date() } });
      }

      const execution = await withMarketDatabase(marketVersionFile(id), 'candidate', () =>
        collectInReplica(
          { ...input, targetDate: version.targetDate },
          version.runId,
          Boolean(retryRunId && active?.phase === 'interrupted'),
        ),
      );
      const review = await finalize(version, operation);
      return {
        mode: 'candidate' as const,
        runId: version.runId,
        targetDate: version.targetDate,
        phase: review.phase,
        candidateVersion: review.candidateVersion,
        pending: review.pending,
        execution,
      };
    } catch (error) {
      await app.marketVersion.updateMany({
        where: { id, operation },
        data: { phase: 'interrupted', operation: null },
      });
      throw error;
    }
  });
}

export async function repairMarketVersion<Result>(
  version: MarketVersion,
  apply: boolean,
  repair: () => Promise<Result>,
) {
  const filename = marketVersionFile(version.id);
  const app = getApplicationDatabase();
  return withMaintenanceLock(async () => {
    const current = await app.marketVersion.findUniqueOrThrow({ where: { id: version.id } });
    if (
      !current.readyAt ||
      current.activeSlot !== 1 ||
      current.operation ||
      !['awaiting_repair', 'awaiting_publish'].includes(current.phase)
    ) {
      throw new IngestionError('candidate_state_conflict');
    }
    if (!apply) {
      return withMarketDatabase(filename, 'review', repair);
    }
    const operation = randomUUID();
    await app.marketVersion.update({
      where: { id: current.id, operation: null, phase: current.phase },
      data: { operation, phase: 'repairing' },
    });
    try {
      // 发布前失败的文件可能已封存；只有持执行权的未发布候选能够重新开放。
      // Only an exclusively claimed unpublished candidate may reopen after a failed publication.
      await chmod(filename, OWNER_READ_WRITE);
      return await withMarketDatabase(filename, 'candidate', repair);
    } finally {
      await finalize(current, operation);
    }
  });
}

export async function recoverMarketVersion(version: MarketVersion) {
  const runId = version.runId;
  if (version.publishedAt) {
    return { runId, phase: 'published', cleaned: true };
  }
  if (!version.operation || !['running', 'repairing', 'publishing'].includes(version.phase)) {
    throw new IngestionError('candidate_state_conflict');
  }
  const phase = version.readyAt
    ? (await finalize(version, version.operation)).phase
    : 'interrupted';
  if (!version.readyAt) {
    await getApplicationDatabase().marketVersion.update({
      where: { id: version.id, operation: version.operation },
      data: { phase, operation: null },
    });
  }
  return { runId, phase };
}
