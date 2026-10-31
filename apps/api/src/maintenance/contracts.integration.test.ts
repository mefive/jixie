import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { proveRange, capturedAt } from '../../tests/market-contract-fixtures.js';
import { withMaintenanceLock } from '#infra/coordination/market-access.js';
import { recordAttempt, publishWindow } from './publication.js';
import { completeResponse } from '#market/synchronization/source.js';
import type { PlannedPartition } from './partitions.js';

it('supersedes prior catalog errors and revokes only dependent eligibility when catalog values change', async () =>
  withSyncDatabase(async (database) => {
    const partition: PlannedPartition = {
      id: 'current',
      dataset: 'stock-master',
      scope: 'L',
      startDate: '20260916',
      endDate: '20260916',
      history: false,
    };
    await database.marketDataState.create({ data: { key: 'global' } });
    await database.datasetSyncPartition.create({
      data: {
        id: 'old-error',
        dataset: 'stock-master',
        scope: 'L',
        startDate: '20260911',
        endDate: '20260911',
        status: 'error',
        error: 'Original source failure',
      },
    });
    for (const dataset of ['stock-prices', 'index-prices']) {
      const scope = dataset === 'stock-prices' ? 'all' : '000300.SH';
      await proveRange(database, { dataset, scope, startDate: '20260916', endDate: '20260916' });
      await database.datasetSyncState.create({
        data: { dataset, scope, verifiedThrough: '20260916' },
      });
    }
    const prepared = completeResponse({
      pages: { rows: [], complete: true, pages: 1, errors: [] },
      table: 'StockBasic',
      coverageComplete: true,
      records: [
        {
          values: {
            tsCode: '600000.SH',
            symbol: '600000',
            name: 'Fixture',
            listStatus: 'L',
            listDate: '20000101',
          },
        },
      ],
    });

    await withMaintenanceLock(async () => {
      await recordAttempt(partition, 'run', capturedAt);
      await publishWindow(partition, prepared, 'run', capturedAt);
    });

    expect(
      await database.datasetSyncPartition.findUnique({ where: { id: 'old-error' } }),
    ).toMatchObject({
      status: 'superseded',
      error: 'Original source failure',
      checkedAt: null,
    });
    expect(
      await database.datasetSyncPartition.findFirst({ where: { dataset: 'stock-prices' } }),
    ).toMatchObject({ status: 'partial' });
    expect(
      await database.datasetSyncState.findFirst({ where: { dataset: 'stock-prices' } }),
    ).toMatchObject({ verifiedThrough: null });
    expect(
      await database.datasetSyncState.findFirst({ where: { dataset: 'index-prices' } }),
    ).toMatchObject({ verifiedThrough: '20260916' });
  }));
