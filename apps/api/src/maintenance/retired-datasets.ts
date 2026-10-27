import { getDatabase } from '#infra/database/prisma.js';
import {
  assertMaintenanceOwner,
  withMarketPublication,
} from '#infra/coordination/market-access.js';

export const RETIRED_DATASETS = [
  'stock-moneyflow',
  'stock-toplist',
  'industry-members',
  'industry-prices',
];

/**
 * 持有维护锁时，仅清理已退役来源的维护记录。
 *
 * Remove maintenance records for retired sources while holding the maintenance lock.
 */
export async function retireDatasets(): Promise<void> {
  assertMaintenanceOwner();

  await withMarketPublication(() =>
    getDatabase().$transaction([
      getDatabase().datasetSyncPartition.deleteMany({
        where: { dataset: { in: RETIRED_DATASETS } },
      }),
      getDatabase().datasetSyncState.deleteMany({
        where: { dataset: { in: RETIRED_DATASETS } },
      }),
      getDatabase().marketRecordEvidence.deleteMany({
        where: { tableName: { in: ['Moneyflow', 'TopList', 'SwIndustryMember', 'SwIndexDaily'] } },
      }),
    ]),
  );
}
