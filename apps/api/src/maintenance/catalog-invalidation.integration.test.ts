import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { proveRange, capturedAt } from '../../tests/market-contract-fixtures.js';
import { withMaintenanceLock } from '#infra/coordination/market-access.js';
import { completeResponse } from '#market/synchronization/source.js';
import type { PreparedMarketPartition, MarketRow } from '#market/synchronization/partition.js';
import { recordAttempt, publishWindow } from './publication.js';
import { selectSyncWindow } from './partitions.js';
import { DATASET_POLICIES } from '#market/synchronization/policies.js';

const stock = {
  tsCode: '000001.SZ',
  symbol: '000001',
  name: 'Original',
  listStatus: 'L',
  listDate: '20150101',
  exchange: 'SZSE',
};

it('refreshes a recent catalog when migrated exchange metadata is still unknown', async () =>
  withSyncDatabase(async (database) => {
    await database.stockBasic.create({ data: { ...stock, exchange: null } });
    for (const scope of ['L', 'D', 'P']) {
      await proveRange(database, {
        dataset: 'stock-master',
        scope,
        startDate: '20260916',
        endDate: '20260916',
      });
    }
    const input = {
      policy: DATASET_POLICIES.find((policy) => policy.dataset === 'stock-master')!,
      targetDate: '20260923',
      startedAt: capturedAt,
      history: false,
      attempted: new Set<string>(),
      deadline: Number.POSITIVE_INFINITY,
    };

    expect(await selectSyncWindow(input)).toMatchObject({ dataset: 'stock-master', scope: 'L' });
    await database.stockBasic.update({
      where: { tsCode: stock.tsCode },
      data: { exchange: 'SZSE' },
    });
    expect(await selectSyncWindow(input)).toBeNull();
  }));

async function publishCatalog(dataset: string, records: MarketRow[], failed = false) {
  const partition = {
    id: 'catalog-refresh',
    dataset,
    scope: dataset === 'stock-master' ? 'L' : 'all',
    startDate: '20260923',
    endDate: '20260923',
    history: false,
  };
  const prepared: PreparedMarketPartition = completeResponse({
    pages: { rows: [], complete: !failed, pages: 1, errors: failed ? ['Source unavailable'] : [] },
    table: dataset === 'stock-master' ? 'StockBasic' : 'EtfBasic',
    coverageComplete: !failed,
    records: records.map((values) => ({ values })),
    allowEmpty: true,
  });

  await withMaintenanceLock(async () => {
    await recordAttempt(partition, 'test-run', capturedAt);
    await publishWindow(partition, prepared, 'test-run', capturedAt);
  });
}

it.each(['rename', 'new-listing', 'correct-listing', 'failed-fetch'])(
  'preserves unrelated historical proofs after %s',
  async (change) =>
    withSyncDatabase(async (database) => {
      await database.marketDataState.create({ data: { key: 'global' } });
      await database.stockBasic.create({ data: stock });
      const dates = ['20150105', '20260922', '20260923'];
      const datasets = ['stock-prices', 'stock-adjustments', 'stock-valuations', 'stock-limits'];
      for (const dataset of datasets) {
        await database.datasetSyncState.create({ data: { dataset, scope: 'all' } });

        for (const date of dates) {
          await proveRange(database, { dataset, scope: 'all', startDate: date, endDate: date });
        }
      }
      let records: MarketRow[] = [];
      switch (change) {
        case 'rename':
          records = [{ ...stock, name: 'Renamed', area: 'New area' }];
          break;
        case 'new-listing':
          records = [{ ...stock, tsCode: '000002.SZ', listDate: '20260923' }];
          break;
        case 'correct-listing':
          records = [{ ...stock, listDate: '20150106' }];
          break;
      }

      await publishCatalog('stock-master', records, change === 'failed-fetch');
      const proofs = await database.datasetSyncPartition.findMany({
        where: { dataset: { in: datasets } },
      });
      expect(proofs).toHaveLength(12);
      for (const proof of proofs) {
        const affected =
          (change === 'new-listing' && proof.startDate === '20260923') ||
          (change === 'correct-listing' && proof.startDate === '20150105');
        expect(proof.status).toBe(affected ? 'partial' : 'complete');
      }
    }),
);

it('limits ETF invalidation to listed download codes and changed dates', async () =>
  withSyncDatabase(async (database) => {
    await database.marketDataState.create({ data: { key: 'global' } });
    const etf = {
      tsCode: '510300.SH',
      name: 'ETF',
      listStatus: 'L',
      listDate: '20150101',
      exchange: 'SH',
      sameDayTurnover: false,
    };
    await database.etfBasic.createMany({ data: [etf, { ...etf, tsCode: '510500.SH' }] });
    await database.marketDownloadList.create({ data: { assetType: 'etf', codes: ['510300.SH'] } });
    for (const scope of ['510300.SH', '510500.SH']) {
      await database.datasetSyncState.create({ data: { dataset: 'etf-prices', scope } });

      for (const startDate of ['20150105', '20260923']) {
        await proveRange(database, { dataset: 'etf-prices', scope, startDate, endDate: startDate });
      }
    }

    await publishCatalog('etf-master', [
      { ...etf, tsCode: '510500.SH', listDate: '20260923' },
      { ...etf, tsCode: '158900.SZ', listDate: '20261029', exchange: 'SZ' },
      { ...etf, name: 'Renamed', managerName: 'New manager' },
    ]);
    expect(
      await database.datasetSyncPartition.count({
        where: { dataset: 'etf-prices', status: 'complete' },
      }),
    ).toBe(4);
    await publishCatalog('etf-master', [{ ...etf, listDate: '20150106' }]);
    const revoked = await database.datasetSyncPartition.findMany({
      where: { dataset: 'etf-prices', status: 'partial' },
    });
    expect(revoked).toMatchObject([{ scope: '510300.SH', startDate: '20150105' }]);
    expect(revoked).toHaveLength(1);
  }));
