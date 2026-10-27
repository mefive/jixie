import { getDatabase } from '#infra/database/prisma.js';
import {
  assertMaintenanceOwner,
  withMarketPublication,
} from '#infra/coordination/market-access.js';

export const RETIRED_STOCK_DATASETS = ['stock-moneyflow', 'stock-toplist'];

/**
 * 持有维护锁时，仅清理已退役股票来源的维护记录。
 *
 * Remove maintenance records for retired stock sources while holding the maintenance lock.
 */
export async function retireStockDatasets(): Promise<void> {
  assertMaintenanceOwner();

  await withMarketPublication(() =>
    getDatabase().$transaction([
      getDatabase().datasetSyncPartition.deleteMany({
        where: { dataset: { in: RETIRED_STOCK_DATASETS } },
      }),
      getDatabase().datasetSyncState.deleteMany({
        where: { dataset: { in: RETIRED_STOCK_DATASETS } },
      }),
      getDatabase().marketRecordEvidence.deleteMany({
        where: { tableName: { in: ['Moneyflow', 'TopList'] } },
      }),
    ]),
  );
}
