import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import {
  capturedAt,
  proveRange,
  proveStockCatalog,
  seedSessions,
} from '../../../tests/market-contract-fixtures.js';
import { withMaintenanceLock } from '#infra/coordination/market-access.js';
import { recordAttempt, publishWindow } from '#maintenance/publication.js';
import { cleanData } from '#maintenance/clean.js';
import { prepareStockPartition } from './sync-partition.js';
import type { TushareRow } from '../providers/tushare/tushare-client.js';
import type { Prisma } from '#infra/database/prisma.js';

const date = '20260904';
const partition = {
  id: 'limits-scope',
  dataset: 'stock-limits',
  scope: 'all',
  startDate: date,
  endDate: date,
  history: true,
};
const stock = {
  tsCode: '600000.SH',
  symbol: '600000',
  name: 'Stock',
  listStatus: 'L',
  listDate: '19990101',
  exchange: 'SSE',
};
const limit = {
  ts_code: stock.tsCode,
  trade_date: date,
  up_limit: 12,
  down_limit: 8,
  asset_type: 'STK',
  exchange: 'SSE',
};
const extras = [
  { ...limit, ts_code: '900901.BJ', exchange: 'BSE' },
  { ...limit, ts_code: '200011.SZ', exchange: 'SZSE' },
  { ...limit, ts_code: '510300.SH' },
];

async function seed(database: Prisma) {
  await seedSessions(database, date);
  await proveStockCatalog(database);
  await proveRange(database, {
    dataset: 'stock-prices',
    scope: 'all',
    startDate: date,
    endDate: date,
  });
  await database.stockBasic.create({ data: stock });
  await database.etfBasic.create({
    data: {
      tsCode: '510300.SH',
      name: 'ETF',
      exchange: 'SH',
      listStatus: 'L',
      sameDayTurnover: false,
    },
  });
  await database.daily.create({ data: { tsCode: stock.tsCode, tradeDate: date, close: 10 } });
  await database.marketDataState.create({ data: { key: 'global' } });
  await database.stkLimit.createMany({
    data: [stock.tsCode, '900901.BJ', '510300.SH', '000099.SZ'].map((tsCode) => ({
      tsCode,
      tradeDate: date,
      upLimit: 11,
      downLimit: 9,
    })),
  });
  await database.stkLimit.create({
    data: { tsCode: '900901.BJ', tradeDate: '20260903', upLimit: 11, downLimit: 9 },
  });
}

describe('stock-limit identity and historical scope', () => {
  it('filters proven extras and withholds unknown identities before business writes', async () =>
    withSyncDatabase(async (database) => {
      await seed(database);
      const prepared = await prepareStockPartition(
        { call: async () => [limit, ...extras, { ...limit, ts_code: '000098.SZ' }] },
        partition,
      );

      expect(prepared.status).toBe('partial');
      expect(prepared.checks.excludedRows).toBe(3);
      expect(prepared.tables[0].records.map((row) => row.values.tsCode)).toEqual([stock.tsCode]);
      expect(prepared.gaps.join()).toContain('000098.SZ');
      await withMaintenanceLock(async () => {
        await recordAttempt(partition, 'scope-run', capturedAt);
        await publishWindow(partition, prepared, 'scope-run', capturedAt);
      });
      expect(await database.stkLimit.count({ where: { tsCode: '000098.SZ' } })).toBe(0);
      expect(await database.stkLimit.count()).toBe(5);
    }));

  it('removes only proven out-of-scope history in the verified day and publishes once', async () =>
    withSyncDatabase(async (database) => {
      await seed(database);
      const prepared = await prepareStockPartition(
        { call: async () => [limit, ...extras] },
        partition,
      );
      expect(prepared).toMatchObject({ status: 'complete', errors: [], gaps: [] });

      await withMaintenanceLock(async () => {
        await recordAttempt(partition, 'scope-run', capturedAt);
        const first = await publishWindow(partition, prepared, 'scope-run', capturedAt);
        expect(first.accepted.deleted).toBe(2);
        expect(
          (await publishWindow(partition, prepared, 'scope-run', capturedAt)).accepted.changed,
        ).toBe(false);
      });
      expect(
        await database.stkLimit.findMany({ orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }] }),
      ).toMatchObject([
        { tsCode: '000099.SZ', tradeDate: date },
        { tsCode: stock.tsCode, tradeDate: date, upLimit: 12 },
        { tsCode: '900901.BJ', tradeDate: '20260903' },
      ]);
      expect(
        await database.datasetSyncPartition.findUnique({ where: { id: partition.id } }),
      ).toMatchObject({ status: 'complete' });
      expect(
        (await database.marketDataState.findUniqueOrThrow({ where: { key: 'global' } })).revision,
      ).toBe(1);
    }));

  it('does not conceal a real stock-catalog conflict behind a B-share number range', async () =>
    withSyncDatabase(async (database) => {
      await seed(database);
      await database.stockBasic.create({
        data: { ...stock, tsCode: '900901.BJ', exchange: 'SSE' },
      });
      const prepared = await prepareStockPartition(
        { call: async () => [limit, ...extras] },
        partition,
      );

      expect(prepared.status).toBe('error');
      expect(prepared.errors.join()).toContain('Conflicting stock identity 900901.BJ');
    }));

  it('recomputes the observation maximum when the verified day contained only excluded limits', async () =>
    withSyncDatabase(async (database) => {
      await seed(database);
      await database.stkLimit.deleteMany({ where: { tsCode: { not: '900901.BJ' } } });
      await database.datasetSyncState.create({
        data: { dataset: 'stock-limits', scope: 'all', maxObservedDate: date },
      });
      const prepared = await prepareStockPartition({ call: async () => [extras[0]] }, partition);

      await withMaintenanceLock(async () => {
        await recordAttempt(partition, 'scope-run', capturedAt);
        await publishWindow(partition, prepared, 'scope-run', capturedAt);
      });
      expect(
        await database.datasetSyncState.findUnique({
          where: { dataset_scope: { dataset: 'stock-limits', scope: 'all' } },
        }),
      ).toMatchObject({ maxObservedDate: '20260903' });
    }));

  it.each(['failure', 'truncated', 'catalog-conflict', 'invalid-date'])(
    'retains historical exclusions after %s',
    async (scenario) =>
      withSyncDatabase(async (database) => {
        await seed(database);
        const prepared = await prepareStockPartition(
          {
            call: async (_api, params): Promise<TushareRow[]> => {
              if (
                scenario === 'failure' ||
                (scenario === 'truncated' && Number(params?.offset) > 0)
              ) {
                throw new Error('Controlled source failure');
              }
              if (scenario === 'truncated') {
                return Array.from({ length: 1000 }, () => limit);
              }
              if (scenario === 'catalog-conflict') {
                return [{ ...limit, exchange: 'BSE' }, ...extras];
              }

              return [limit, ...extras, { ...extras[0], trade_date: 'bad' }];
            },
          },
          partition,
        );
        expect(prepared.status).toBe('error');

        await withMaintenanceLock(async () => {
          await recordAttempt(partition, 'scope-run', capturedAt);
          const result = await publishWindow(partition, prepared, 'scope-run', capturedAt);
          expect(result.accepted.deleted).toBe(0);
        });
        expect(await database.stkLimit.count()).toBe(5);
        expect(
          await database.datasetSyncPartition.findUnique({ where: { id: partition.id } }),
        ).toMatchObject({ status: 'error' });
      }),
  );

  it('rolls back values, scope cleanup and proofs together if revision publication fails', async () =>
    withSyncDatabase(async (database) => {
      await seed(database);
      const prepared = await prepareStockPartition(
        { call: async () => [limit, ...extras] },
        partition,
      );
      await database.$executeRawUnsafe(
        `CREATE TRIGGER reject_limit_revision BEFORE UPDATE ON MarketDataState
         BEGIN
           SELECT RAISE(ABORT, 'fixture publication failure');
         END`,
      );

      await withMaintenanceLock(async () => {
        await recordAttempt(partition, 'scope-run', capturedAt);
        await expect(publishWindow(partition, prepared, 'scope-run', capturedAt)).rejects.toThrow();
      });
      expect(await database.stkLimit.count()).toBe(5);
      expect(
        await database.stkLimit.findUnique({
          where: { tsCode_tradeDate: { tsCode: stock.tsCode, tradeDate: date } },
        }),
      ).toMatchObject({ upLimit: 11 });
      expect(
        await database.datasetSyncPartition.findUnique({ where: { id: partition.id } }),
      ).toMatchObject({ status: 'pending' });
    }));

  it('cleans other dates only through manual cleanup and invalidates affected limits alone', async () =>
    withSyncDatabase(async (database) => {
      await seed(database);
      await database.stkLimit.create({
        data: { tsCode: '900901.BJ', tradeDate: '20261031', upLimit: 11, downLimit: 9 },
      });
      for (const session of ['20260902', '20260903', date, '20261031']) {
        await proveRange(database, {
          dataset: 'stock-limits',
          scope: 'all',
          startDate: session,
          endDate: session,
        });
      }
      await database.datasetSyncState.create({
        data: { dataset: 'stock-limits', scope: 'all', maxObservedDate: '20261031' },
      });
      const preview = await cleanData({ apply: false });
      expect(
        preview.items
          .filter((item) => item.table === 'StkLimit')
          .reduce((sum, item) => sum + item.count, 0),
      ).toBe(4);
      expect(await database.stkLimit.count()).toBe(6);

      const applied = await cleanData({
        apply: true,
        backup: async () => 'verified-fixture-backup',
      });
      expect(applied.changed).toBe(4);
      expect(applied.invalidatedPartitions).toBe(3);
      expect(
        await database.datasetSyncState.findUnique({
          where: { dataset_scope: { dataset: 'stock-limits', scope: 'all' } },
        }),
      ).toMatchObject({ maxObservedDate: date });
      expect(await database.stkLimit.findMany({ orderBy: { tsCode: 'asc' } })).toMatchObject([
        { tsCode: '000099.SZ' },
        { tsCode: stock.tsCode },
      ]);
      expect(
        await database.datasetSyncPartition.findFirst({ where: { dataset: 'stock-prices' } }),
      ).toMatchObject({ status: 'complete' });
      expect(
        await database.datasetSyncPartition.findFirst({
          where: { dataset: 'stock-limits', startDate: '20260902' },
        }),
      ).toMatchObject({ status: 'complete' });
    }));
});
