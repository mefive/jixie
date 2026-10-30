import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { proveRange, capturedAt } from '../../tests/market-contract-fixtures.js';
import { withMaintenanceLock } from '#infra/coordination/market-access.js';
import { reconcileSyncRules } from './reconcile.js';
import { recordAttempt, publishWindow } from './publication.js';
import { completeResponse } from '#market/synchronization/source.js';
import type { PlannedPartition } from './partitions.js';

it('revokes old eligibility once while preserving raw rows, capture times and source failures', async () =>
  withSyncDatabase(async (database) => {
    await database.indexDaily.create({
      data: { tsCode: '000300.SH', tradeDate: '20260916', close: 100 },
    });
    await database.datasetSyncPartition.create({
      data: {
        id: 'old',
        dataset: 'index-prices',
        scope: '000300.SH',
        startDate: '20260916',
        endDate: '20260916',
        policyVersion: 'sync-v1',
        status: 'error',
        error: 'Original failure',
        checkedAt: capturedAt,
      },
    });
    await database.datasetSyncState.create({
      data: {
        dataset: 'index-prices',
        scope: '000300.SH',
        verifiedThrough: '20260916',
        maxObservedDate: '20260916',
      },
    });

    await withMaintenanceLock(reconcileSyncRules);
    await withMaintenanceLock(reconcileSyncRules);

    expect(await database.datasetSyncPartition.findUnique({ where: { id: 'old' } })).toMatchObject({
      status: 'superseded',
      error: 'Original failure',
      checkedAt: capturedAt,
    });
    expect(await database.datasetSyncState.findFirst()).toMatchObject({
      verifiedThrough: null,
      maxObservedDate: '20260916',
    });
    expect(await database.indexDaily.findFirst()).toMatchObject({ close: 100 });
    expect(await database.marketDataState.findFirst()).toMatchObject({ revision: 1 });
  }));

it('supersedes prior catalog errors and revokes only dependent eligibility when catalog values change', async () =>
  withSyncDatabase(async (database) => {
    const partition: PlannedPartition = {
      id: 'current',
      dataset: 'stock-master',
      scope: 'L',
      startDate: '20260916',
      endDate: '20260916',
      policyVersion: 'sync-v2',
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
        policyVersion: 'sync-v2',
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
