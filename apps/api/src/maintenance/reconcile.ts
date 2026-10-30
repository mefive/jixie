import { getDatabase } from '#infra/database/prisma.js';
import {
  assertMaintenanceOwner,
  withMarketPublication,
} from '#infra/coordination/market-access.js';
import { DATASET_POLICIES } from '#market/synchronization/policies.js';

/**
 * 新规则撤销旧资格并保留原始值；重复执行无变化。
 *
 * Revoke obsolete eligibility, retain values, and remain idempotent.
 */
export async function reconcileSyncRules(): Promise<void> {
  assertMaintenanceOwner();
  const database = getDatabase();
  const obsolete = await database.datasetSyncPartition.findMany({
    where: {
      OR: DATASET_POLICIES.map((policy) => ({
        dataset: policy.dataset,
        policyVersion: { not: policy.version },
        status: { not: 'superseded' },
      })),
    },
    select: { dataset: true, scope: true },
    distinct: ['dataset', 'scope'],
  });
  if (!obsolete.length) {
    return;
  }

  await withMarketPublication(() =>
    database.$transaction(async (transaction) => {
      for (const { dataset, scope } of obsolete) {
        await transaction.datasetSyncPartition.updateMany({
          where: {
            dataset,
            scope,
            policyVersion: {
              not: DATASET_POLICIES.find((policy) => policy.dataset === dataset)!.version,
            },
          },
          data: { status: 'superseded' },
        });
        await transaction.datasetSyncState.updateMany({
          where: { dataset, scope },
          data: { verifiedThrough: null },
        });
      }
      await transaction.marketDataState.upsert({
        where: { key: 'global' },
        create: { key: 'global', revision: 1 },
        update: { revision: { increment: 1 } },
      });
    }),
  );
}
