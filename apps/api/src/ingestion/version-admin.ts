import { access } from 'node:fs/promises';
import { withMaintenanceLock, acquireMarketLock } from '#infra/coordination/market-access.js';
import { getApplicationDatabase } from '#infra/database/prisma.js';
import { marketVersionFile } from '#infra/database/filename.js';
import { IngestionError } from './errors.js';

export async function manageMarketVersion(
  runId: string,
  action: 'rollback-run' | 'retain-run' | 'release-run',
) {
  return withMaintenanceLock(async () => {
    const app = getApplicationDatabase();
    const version = await app.marketVersion.findUniqueOrThrow({ where: { runId } });
    if (!version.publishedAt || version.historyVersionId) {
      throw new IngestionError('candidate_state_conflict');
    }
    await access(marketVersionFile(version.id));
    if (action !== 'rollback-run') {
      return app.marketVersion.update({
        where: { id: version.id },
        data: { retained: action === 'retain-run' },
        select: { id: true, retained: true },
      });
    }

    const lock = await acquireMarketLock('market-access', false, 120_000);
    try {
      return await app.$transaction(async (tx) => {
        const pointer = await tx.marketPublication.findUniqueOrThrow({ where: { key: 'global' } });
        if (
          pointer.previousVersionId !== version.id ||
          !pointer.currentVersionId ||
          (await tx.marketVersion.count({ where: { activeSlot: 1 } }))
        ) {
          throw new IngestionError('candidate_state_conflict');
        }
        const sequence = pointer.sequence + 1;
        await tx.marketRollback.create({
          data: { sequence, fromVersionId: pointer.currentVersionId, toVersionId: version.id },
        });
        return tx.marketPublication.update({
          where: { key: 'global', sequence: pointer.sequence },
          data: {
            sequence,
            currentVersionId: version.id,
            previousVersionId: pointer.currentVersionId,
          },
        });
      });
    } finally {
      await lock.release();
    }
  });
}
