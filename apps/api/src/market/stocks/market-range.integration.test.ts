import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import {
  proveRange,
  proveStockCatalog,
  seedSessions,
} from '../../../tests/market-contract-fixtures.js';
import { prepareStockPartition } from './sync-partition.js';
import type { SyncSource } from '../synchronization/source.js';
import type { TushareRow } from '../providers/tushare/tushare-client.js';

describe('shared market admission rules', () => {
  it('shares market boundaries between incoming rows and expected coverage', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, '20150105');
      await proveStockCatalog(database);
      await database.stockBasic.createMany({
        data: [
          {
            tsCode: '000001.SZ',
            symbol: '000001',
            name: 'Listed',
            listStatus: 'L',
            exchange: 'SZSE',
            listDate: '19910101',
          },
          {
            tsCode: '920489.BJ',
            symbol: '920489',
            name: 'Predecessor market',
            listStatus: 'L',
            exchange: 'BSE',
            listDate: '20100101',
          },
        ],
      });
      const source: SyncSource = {
        call: async (api: string): Promise<TushareRow[]> =>
          api === 'suspend_d'
            ? []
            : [
                {
                  ts_code: '000001.SZ',
                  trade_date: '20150105',
                  open: 10,
                  close: 10,
                  high: 10,
                  low: 10,
                },
                { ts_code: '920489.BJ', trade_date: '20150105', close: -1 },
                { ts_code: '920139.BJ', trade_date: '20150105', close: -1 },
              ],
      };

      const result = await prepareStockPartition(source, {
        dataset: 'stock-prices',
        scope: 'all',
        startDate: '20150105',
        endDate: '20150105',
      });
      expect(result).toMatchObject({
        status: 'complete',
        errors: [],
        gaps: [],
        checks: { excludedRows: 2 },
      });
      expect(result.tables[0].records.map((row) => row.values.tsCode)).toEqual(['000001.SZ']);
    }));

  it('rejects malformed identities instead of filtering them', async () =>
    withSyncDatabase(async () => {
      const result = await prepareStockPartition(
        {
          call: async (api) =>
            api === 'suspend_d' ? [] : [{ ts_code: 'bad.BJ', trade_date: '20150105', close: 1 }],
        },
        { dataset: 'stock-prices', scope: 'all', startDate: '20150105', endDate: '20150105' },
      );

      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('invalid stock/date')]),
      );
      expect(result.checks.excludedRows).toBe(0);
    }));
});

it.each(['stock-prices', 'stock-adjustments', 'stock-valuations', 'stock-limits'])(
  'filters the same pre-listing and post-delisting identities for %s',
  async (dataset) =>
    withSyncDatabase(async (database) => {
      const date = '20260916';
      await seedSessions(database, date);
      await proveStockCatalog(database);
      await database.stockBasic.createMany({
        data: [
          {
            tsCode: '000001.SZ',
            symbol: '000001',
            name: 'Trading',
            listStatus: 'L',
            exchange: 'SZSE',
            listDate: '19910101',
          },
          {
            tsCode: '000002.SZ',
            symbol: '000002',
            name: 'Future',
            listStatus: 'L',
            exchange: 'SZSE',
            listDate: '20260917',
          },
          {
            tsCode: '000003.SZ',
            symbol: '000003',
            name: 'Delisted',
            listStatus: 'D',
            exchange: 'SZSE',
            listDate: '19910101',
            delistDate: '20260915',
          },
          { tsCode: '000004.SZ', symbol: '000004', name: 'Unlisted', listStatus: 'UN' },
        ],
      });
      await proveRange(database, {
        dataset: 'stock-prices',
        scope: 'all',
        startDate: date,
        endDate: date,
      });
      await database.daily.create({ data: { tsCode: '000001.SZ', tradeDate: date, close: 10 } });
      const rows = ['000001.SZ', '000002.SZ', '000003.SZ', '000004.SZ'].map((code) => ({
        ts_code: code,
        trade_date: date,
        open: 10,
        high: 10,
        low: 10,
        close: 10,
        adj_factor: 1,
        up_limit: 11,
        down_limit: 9,
      }));

      const prepared = await prepareStockPartition(
        { call: async (api) => (api === 'suspend_d' ? [] : rows) },
        {
          dataset,
          scope: 'all',
          startDate: date,
          endDate: date,
        },
      );

      expect(prepared).toMatchObject({
        status: 'complete',
        errors: [],
        gaps: [],
        checks: { excludedRows: 3 },
      });
      expect(prepared.tables[0].records.map((record) => record.values.tsCode)).toEqual([
        '000001.SZ',
      ]);
    }),
);

it.each([true, false])(
  'records source absence without inventing suspension history: evidence=%s',
  async (evidence) =>
    withSyncDatabase(async (database) => {
      const date = '20150105';
      await seedSessions(database, date);
      await proveStockCatalog(database);
      await database.stockBasic.createMany({
        data: [
          {
            tsCode: '000001.SZ',
            symbol: '000001',
            name: 'Trading',
            listStatus: 'L',
            exchange: 'SZSE',
            listDate: '19910101',
          },
          {
            tsCode: '000002.SZ',
            symbol: '000002',
            name: 'Paused',
            listStatus: 'P',
            exchange: 'SZSE',
            listDate: '19910101',
          },
          { tsCode: '000003.SZ', symbol: '000003', name: 'Never listed', listStatus: 'G' },
        ],
      });
      const prepared = await prepareStockPartition(
        {
          call: async (api): Promise<TushareRow[]> => {
            if (api === 'suspend_d') {
              return evidence
                ? [
                    {
                      ts_code: '000002.SZ',
                      trade_date: date,
                      suspend_type: 'S',
                      suspend_timing: null,
                    },
                  ]
                : [];
            }
            return [
              { ts_code: '000001.SZ', trade_date: date, open: 10, high: 10, low: 10, close: 10 },
            ];
          },
        },
        { dataset: 'stock-prices', scope: 'all', startDate: date, endDate: date },
      );

      expect(prepared.errors).toEqual([]);
      expect(prepared.status).toBe('complete');
      expect(prepared.gaps).toEqual([]);
      if (!evidence) {
        expect(prepared.notes?.join()).toContain('Source returned no stock prices: 000002.SZ');
      }
    }),
);

it('accepts traded history of a currently paused listing without discarding it', async () =>
  withSyncDatabase(async (database) => {
    const date = '20150105';
    await seedSessions(database, date);
    await proveStockCatalog(database);
    await database.stockBasic.create({
      data: {
        tsCode: '000001.SZ',
        symbol: '000001',
        name: 'Paused now',
        listStatus: 'P',
        exchange: 'SZSE',
        listDate: '19910101',
      },
    });

    const prepared = await prepareStockPartition(
      {
        call: async (api) =>
          api === 'suspend_d'
            ? []
            : [
                {
                  ts_code: '000001.SZ',
                  trade_date: date,
                  open: 10,
                  high: 10,
                  low: 10,
                  close: 10,
                },
              ],
      },
      { dataset: 'stock-prices', scope: 'all', startDate: date, endDate: date },
    );

    expect(prepared).toMatchObject({
      status: 'complete',
      errors: [],
      gaps: [],
      checks: { excludedRows: 0 },
    });
    expect(prepared.tables[0].records).toHaveLength(1);
  }));
