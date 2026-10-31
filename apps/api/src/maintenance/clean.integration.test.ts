import { describe, expect, it, vi } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { proveRange, seedSessions } from '../../tests/market-contract-fixtures.js';
import { cleanData } from './clean.js';
import { synchronizeData } from './sync.js';

describe('manual market cleanup', () => {
  it('does not perform historical cleanup during routine synchronization', async () =>
    withSyncDatabase(async (database) => {
      await database.daily.create({
        data: { tsCode: '000022.SZ', tradeDate: '20150105', close: 1 },
      });
      await database.datasetSyncState.create({ data: { dataset: 'etf-shares', scope: 'all' } });
      await database.marketDownloadList.create({ data: { assetType: 'etf', codes: [] } });

      await synchronizeData({
        targetDate: '20260922',
        startedAt: new Date('2026-10-31T10:00:00Z'),
        signal: AbortSignal.abort(),
        onLog: () => {},
        providers: {
          source: {
            call: async () => {
              throw new Error('No network permitted');
            },
          },
        },
      });
      expect(await database.daily.count({ where: { tsCode: '000022.SZ' } })).toBe(1);
      expect(await database.datasetSyncState.count({ where: { dataset: 'etf-shares' } })).toBe(1);

      const preview = await cleanData({ apply: false });
      expect(preview.summary).toEqual([
        { category: 'pending-etfs', candidates: 0, retained: 0, changed: 0 },
        { category: 'retired-data', candidates: 1, retained: 0, changed: 0 },
        { category: 'stock-identities', candidates: 1, retained: 0, changed: 0 },
        { category: 'market-range', candidates: 0, retained: 1, changed: 0 },
      ]);
    }));

  it('bounds cleanup, retains uncertain history and invalidates proofs atomically', async () =>
    withSyncDatabase(async (database) => {
      await database.stockBasic.createMany({
        data: [
          {
            tsCode: '920139.BJ',
            symbol: '920139',
            name: 'Hualing',
            listStatus: 'L',
            listDate: '20221028',
          },
          {
            tsCode: '000001.SZ',
            symbol: '000001',
            name: 'Unknown history',
            listStatus: 'L',
            listDate: '20200101',
          },
        ],
      });
      await database.daily.createMany({
        data: [
          { tsCode: '920139.BJ', tradeDate: '20150105', close: 1 },
          { tsCode: '920139.BJ', tradeDate: '20150106', close: 2 },
          { tsCode: '920139.BJ', tradeDate: '20221028', close: 3 },
          { tsCode: '000001.SZ', tradeDate: '20150105', close: 4 },
        ],
      });
      await database.dailyBasic.create({
        data: { tsCode: '920139.BJ', tradeDate: '20150105', pe: 10 },
      });
      await database.marketDataState.create({ data: { key: 'global', revision: 7 } });
      await seedSessions(database, '20150105', '20150106');
      for (const dataset of ['stock-prices', 'stock-valuations']) {
        await proveRange(database, {
          dataset,
          scope: 'all',
          startDate: '20150105',
          endDate: '20150106',
        });
        await proveRange(database, {
          dataset,
          scope: 'all',
          startDate: '20221028',
          endDate: '20221028',
        });
        await database.datasetSyncState.create({
          data: {
            dataset,
            scope: 'all',
            verifiedThrough: '20221028',
            maxObservedDate: '20221028',
          },
        });
      }
      const backup = vi.fn(async () => 'verified-fixture-backup');
      const selection = { backup };

      const preview = await cleanData({ ...selection, apply: false });
      expect(preview.items.map((item) => item.count)).toEqual([2, 1]);
      expect(preview.retained).toMatchObject([{ code: '000001.SZ' }]);
      expect(await database.daily.count()).toBe(4);
      expect(backup).not.toHaveBeenCalled();

      const result = await cleanData({ ...selection, apply: true });
      expect(result).toMatchObject({
        changed: 3,
        invalidatedPartitions: 2,
        backup: 'verified-fixture-backup',
      });
      expect(backup).toHaveBeenCalledOnce();
      expect(
        await database.daily.findMany({ orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }] }),
      ).toMatchObject([
        { tsCode: '000001.SZ', tradeDate: '20150105' },
        { tsCode: '920139.BJ', tradeDate: '20221028' },
      ]);
      expect(
        await database.datasetSyncPartition.count({
          where: { startDate: '20221028', status: 'complete' },
        }),
      ).toBe(2);
      expect(
        await database.datasetSyncState.findMany({ orderBy: { dataset: 'asc' } }),
      ).toMatchObject([
        { dataset: 'stock-prices', verifiedThrough: null, maxObservedDate: '20221028' },
        { dataset: 'stock-valuations', verifiedThrough: null, maxObservedDate: null },
      ]);
      expect(
        (await database.marketDataState.findUniqueOrThrow({ where: { key: 'global' } })).revision,
      ).toBe(8);
      expect(await cleanData({ ...selection, apply: true })).toMatchObject({
        changed: 0,
        backup: null,
      });
      expect(backup).toHaveBeenCalledOnce();
    }));

  it('does not change data on backup failure or a cancelled request', async () =>
    withSyncDatabase(async (database) => {
      await database.daily.create({
        data: { tsCode: '920139.BJ', tradeDate: '20150105', close: 1 },
      });
      const input = { apply: true };
      await expect(
        cleanData({
          ...input,
          backup: async () => {
            throw new Error('backup failed');
          },
        }),
      ).rejects.toThrow('backup failed');
      const backup = vi.fn(async () => 'backup');
      await expect(cleanData({ ...input, backup, signal: AbortSignal.abort() })).rejects.toThrow();
      expect(backup).not.toHaveBeenCalled();
      expect(await database.daily.count()).toBe(1);
    }));

  it('merges all confirmed identities while preserving provenance', async () =>
    withSyncDatabase(async (database) => {
      await database.daily.createMany({
        data: [
          { tsCode: '000022.SZ', tradeDate: '20150105', close: 1 },
          { tsCode: '001872.SZ', tradeDate: '20150105', close: 2 },
          { tsCode: '000043.SZ', tradeDate: '20150105', close: 3 },
        ],
      });
      await proveRange(database, {
        dataset: 'stock-prices',
        scope: 'all',
        startDate: '20150105',
        endDate: '20150105',
      });
      expect((await cleanData({ apply: false })).items).toMatchObject([
        { code: '000022.SZ', count: 1 },
        { code: '000043.SZ', count: 1 },
      ]);
      expect(await database.daily.count()).toBe(3);

      const result = await cleanData({ apply: true, backup: async () => 'backup' });
      expect(result.invalidatedPartitions).toBe(1);
      expect(await database.daily.findMany({ orderBy: { tsCode: 'asc' } })).toMatchObject([
        { tsCode: '001872.SZ', close: 2, sourceTsCode: null },
        { tsCode: '001914.SZ', close: 3 },
      ]);
      expect(await cleanData({ apply: true, backup: async () => 'backup' })).toMatchObject({
        changed: 0,
      });
    }));

  it('rolls back data and proofs when publication fails', async () =>
    withSyncDatabase(async (database) => {
      await database.etfBasic.create({
        data: {
          tsCode: '158025.OF',
          name: 'Pending',
          listStatus: 'P',
          exchange: 'SZ',
          sameDayTurnover: false,
        },
      });
      await database.daily.create({
        data: { tsCode: '920139.BJ', tradeDate: '20150105', close: 1 },
      });
      await proveRange(database, {
        dataset: 'stock-prices',
        scope: 'all',
        startDate: '20150105',
        endDate: '20150105',
      });
      await database.marketDataState.create({ data: { key: 'global', revision: 1 } });
      await database.$executeRawUnsafe(
        `CREATE TRIGGER reject_range_cleanup BEFORE UPDATE ON MarketDataState
         BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`,
      );

      await expect(cleanData({ apply: true, backup: async () => 'backup' })).rejects.toThrow();
      expect(await database.daily.count()).toBe(1);
      expect(await database.etfBasic.count()).toBe(1);
      expect(await database.datasetSyncPartition.count({ where: { status: 'complete' } })).toBe(1);
    }));
});
