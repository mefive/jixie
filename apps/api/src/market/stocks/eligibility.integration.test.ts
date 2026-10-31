import { describe, expect, it, vi } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import {
  proveRange,
  proveStockCatalog,
  seedSessions,
} from '../../../tests/market-contract-fixtures.js';
import { prepareStockPartition, prepareStockReference } from './sync-partition.js';
import { preparePendingStockCleanup } from './cleanup-pending.js';
import { datasetScopes } from '../synchronization/scopes.js';
import { DATASET_POLICIES } from '../synchronization/policies.js';
import type { TushareRow } from '../providers/tushare/tushare-client.js';

const date = '20150105';
const partition = { dataset: 'stock-prices', scope: 'all', startDate: date, endDate: date };
const stock = {
  tsCode: '000001.SZ',
  symbol: '000001',
  name: 'Trading',
  listStatus: 'L',
  listDate: '19910101',
  exchange: 'SZSE',
};
const bar = { ts_code: stock.tsCode, trade_date: date, open: 10, high: 10, low: 10, close: 10 };
const limit = {
  ts_code: stock.tsCode,
  trade_date: date,
  up_limit: 11,
  down_limit: 9,
  asset_type: 'STK',
  exchange: 'SZSE',
};

describe('daily stock eligibility', () => {
  it.each(['known-extras', 'unknown-stock', 'conflicting-exchange', 'malformed-extra'])(
    'checks A-share completeness without accepting uncertain identities: %s',
    async (scenario) =>
      withSyncDatabase(async (database) => {
        await seedSessions(database, date);
        await proveStockCatalog(database);
        await proveRange(database, partition);
        await database.stockBasic.create({ data: stock });
        await database.daily.create({ data: { tsCode: stock.tsCode, tradeDate: date, close: 10 } });
        await database.etfBasic.create({
          data: {
            tsCode: '510300.SH',
            name: 'Fund',
            listStatus: 'L',
            exchange: 'SH',
            sameDayTurnover: false,
          },
        });
        const extras: TushareRow[] = [
          { ...limit, ts_code: '200011.SZ' },
          { ...limit, ts_code: '900901.BJ', exchange: 'SSE' },
          { ...limit, ts_code: '510300.SH', exchange: 'SSE' },
        ];
        const rows: TushareRow[] = [limit, ...extras];
        switch (scenario) {
          case 'unknown-stock':
            rows.push({ ...limit, ts_code: '000099.SZ' });
            break;
          case 'conflicting-exchange':
            rows[0] = { ...limit, exchange: 'SSE' };
            break;
          case 'malformed-extra':
            rows.push({ ...limit, ts_code: '900901.BJ', trade_date: 'wrong', exchange: 'SSE' });
            break;
        }

        const result = await prepareStockPartition(
          { call: async () => rows },
          {
            ...partition,
            dataset: 'stock-limits',
          },
        );
        expect(result.checks.excludedRows).toBe(3);
        if (scenario === 'known-extras') {
          expect(result).toMatchObject({ status: 'complete', errors: [], gaps: [] });
          expect(result.tables[0].records.map((row) => row.values.tsCode)).toEqual([stock.tsCode]);
        } else if (scenario === 'unknown-stock') {
          expect(result.status).toBe('partial');
          expect(result.gaps.join()).toContain('000099.SZ');
        } else {
          expect(result.errors.length).toBeGreaterThan(0);
        }
      }),
  );

  it.each(['exchange', 'asset_type'])(
    'reports conflicting %s even before the catalog listing date',
    async (field) =>
      withSyncDatabase(async (database) => {
        await seedSessions(database, date);
        await database.stockBasic.create({ data: { ...stock, listDate: '20150106' } });
        const row = { ...limit, [field]: field === 'exchange' ? 'SSE' : 'FD' };

        const result = await prepareStockPartition(
          { call: async () => [row] },
          { ...partition, dataset: 'stock-limits' },
        );

        expect(result.checks.excludedRows).toBe(0);
        expect(result.errors.join()).toContain(`Conflicting stock identity ${stock.tsCode}`);
        expect(result.tables[0].records).toEqual([]);
      }),
  );

  it('uses dated announcements for the four historical gaps, including currently listed and delisted stocks', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, date);
      await proveStockCatalog(database);
      await database.stockBasic.createMany({
        data: [
          stock,
          { ...stock, tsCode: '000520.SZ' },
          { ...stock, tsCode: '002506.SZ' },
          { ...stock, tsCode: '000594.SZ', listStatus: 'D', delistDate: '20150713' },
          {
            ...stock,
            tsCode: '601268.SH',
            exchange: 'SSE',
            listStatus: 'D',
            delistDate: '20150521',
          },
        ],
      });
      const source = { call: async (api: string) => (api === 'suspend_d' ? [] : [bar]) };

      const result = await prepareStockPartition(source, partition);
      expect(result).toMatchObject({ status: 'complete', errors: [], gaps: [] });
      const conflict = await prepareStockPartition(
        {
          call: async (api) => (api === 'suspend_d' ? [] : [bar, { ...bar, ts_code: '000520.SZ' }]),
        },
        partition,
      );
      expect(conflict.status).toBe('partial');
      expect(conflict.gaps.join()).toContain('Conflicting full-day suspension evidence: 000520.SZ');
    }));

  it('requests only listed-history catalogs and never schedules pending dividends', async () =>
    withSyncDatabase(async (database) => {
      await database.stockBasic.createMany({
        data: [
          stock,
          { ...stock, tsCode: '000002.SZ', listStatus: 'UN', listDate: null },
          { ...stock, tsCode: '000003.SZ', listStatus: 'G', listDate: null },
        ],
      });
      const master = DATASET_POLICIES.find((policy) => policy.dataset === 'stock-master')!;
      expect((await datasetScopes(master)).map((scope) => scope.scope)).toEqual(['L', 'D', 'P']);
      const dividend = DATASET_POLICIES.find((policy) => policy.dataset === 'dividends')!;
      expect((await datasetScopes(dividend)).map((scope) => scope.scope)).toEqual([stock.tsCode]);
      const call = vi.fn(async () => []);
      for (const scope of ['G', 'UN']) {
        await expect(
          prepareStockReference({ call }, { ...partition, dataset: 'stock-master', scope }),
        ).rejects.toThrow('Unsupported stock listing status');
      }
      expect(call).not.toHaveBeenCalled();
    }));

  it('previews pending stocks and protects source history, dates and sync references', async () =>
    withSyncDatabase(async (database) => {
      await database.stockBasic.createMany({
        data: ['000001.SZ', '000002.SZ', '000003.SZ', '000004.SZ', '000005.SZ'].map(
          (tsCode, index) => ({
            ...stock,
            tsCode,
            listStatus: index === 1 ? 'G' : 'UN',
            listDate: index === 3 ? date : null,
          }),
        ),
      });
      await database.daily.create({
        data: { tsCode: '600000.SH', sourceTsCode: '000003.SZ', tradeDate: date },
      });
      await database.datasetSyncState.create({
        data: { dataset: 'dividends', scope: '000005.SZ' },
      });

      await database.$transaction(async (transaction) => {
        const preview = await preparePendingStockCleanup(transaction);
        expect(preview.items.map((item) => item.code)).toEqual(['000001.SZ', '000002.SZ']);
        expect(preview.retained.map((item) => item.code)).toEqual([
          '000003.SZ',
          '000004.SZ',
          '000005.SZ',
        ]);
        expect(await transaction.stockBasic.count()).toBe(5);
        expect(await preview.apply()).toBe(2);
        expect((await preparePendingStockCleanup(transaction)).items).toEqual([]);
      });
    }));
});
