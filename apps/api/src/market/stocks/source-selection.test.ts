import type { TushareRow } from '../providers/tushare/tushare-client.js';
import { describe, expect, it, vi } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { acceptSource, seedSessions } from '../../../tests/market-contract-fixtures.js';
import { StockNameLookup } from '../instruments/stock-identity.js';

const date = '20260916';
const oldCode = '000022.SZ';
const newCode = '001872.SZ';
const bar = { open: 10, high: 12, low: 9, close: 11, vol: 1, amount: 1 };
const datasets = [
  ['stock-prices', bar, { ...bar, close: 12 }, 'close', 12],
  ['stock-adjustments', { adj_factor: 1 }, { adj_factor: 2 }, 'adjFactor', 2],
  ['stock-valuations', { dv_ratio: null }, { dv_ratio: 1.7865 }, 'dvRatio', 1.7865],
  ['stock-limits', { up_limit: 20, down_limit: 1 }, { up_limit: 21, down_limit: 0 }, 'upLimit', 21],
] as const;

describe('stock source selection through maintenance', () => {
  it.each(datasets)(
    'selects and retains the successor for %s',
    async (dataset, old, current, field, value) =>
      withSyncDatabase(async (database) => {
        await seedSessions(database, date);
        await database.stockBasic.create({
          data: {
            tsCode: newCode,
            symbol: '001872',
            name: 'Source fixture',
            exchange: 'SZSE',
            listDate: '19930505',
            listStatus: 'L',
          },
        });
        const partition = { dataset, scope: 'all', startDate: date, endDate: date };
        const previous = { ts_code: oldCode, trade_date: date, ...old };
        const successor = { ts_code: newCode, trade_date: date, ...current };
        const source = (rows: TushareRow[]) => ({
          call: async (api: string) => (api === 'suspend_d' ? [] : rows),
        });
        await acceptSource(database, source([previous]), partition);

        for (const rows of [[previous, successor], [successor, previous], [previous]]) {
          const result = await acceptSource(database, source(rows), partition);
          expect(result.accepted.errors).toEqual([]);
        }
        const stored = {
          'stock-prices': await database.daily.findMany(),
          'stock-adjustments': await database.adjFactor.findMany(),
          'stock-valuations': await database.dailyBasic.findMany(),
          'stock-limits': await database.stkLimit.findMany(),
        }[dataset];
        expect(stored).toMatchObject([{ tsCode: newCode, sourceTsCode: newCode, [field]: value }]);
        expect(
          (await acceptSource(database, source([successor]), partition)).accepted.changed,
        ).toBe(false);
      }),
  );

  it.each([false, true])(
    'selects the observed 2.2/2.2002 valuation, reversed=%s',
    async (reversed) =>
      withSyncDatabase(async (database) => {
        await database.stockBasic.create({
          data: {
            tsCode: '001914.SZ',
            symbol: '001914',
            name: 'Fixture',
            exchange: 'SZSE',
            listDate: '19940101',
            listStatus: 'L',
          },
        });
        const partition = {
          dataset: 'stock-valuations',
          scope: 'all',
          startDate: date,
          endDate: date,
        };
        const rows = [
          { ts_code: '000043.SZ', trade_date: date, dv_ratio: 2.2, dv_ttm: 2.2 },
          { ts_code: '001914.SZ', trade_date: date, dv_ratio: 2.2002, dv_ttm: 2.2002 },
        ];
        const result = await acceptSource(
          database,
          { call: async () => (reversed ? rows.reverse() : rows) },
          partition,
        );
        expect(result.accepted.errors).toEqual([]);
        expect(await database.dailyBasic.findFirst()).toMatchObject({
          dvRatio: 2.2002,
          dvTtm: 2.2002,
        });
      }),
  );

  it('rejects an invalid successor without silently substituting a valid predecessor', async () =>
    withSyncDatabase(async (database) => {
      await database.stockBasic.create({
        data: {
          tsCode: newCode,
          symbol: '001872',
          name: 'Fixture',
          exchange: 'SZSE',
          listDate: '19930505',
          listStatus: 'L',
        },
      });
      const result = await acceptSource(
        database,
        {
          call: async (api) =>
            api === 'suspend_d'
              ? []
              : [
                  { ts_code: oldCode, trade_date: date, ...bar },
                  { ts_code: newCode, trade_date: date, ...bar, close: -1 },
                ],
        },
        { dataset: 'stock-prices', scope: 'all', startDate: date, endDate: date },
      );
      expect(result.prepared.errors.length).toBeGreaterThan(0);
      expect(await database.daily.count()).toBe(0);
    }));

  it('accepts returned prices without a separate suspension-proof request', async () =>
    withSyncDatabase(async (database) => {
      await database.stockBasic.create({
        data: {
          tsCode: newCode,
          symbol: '001872',
          name: 'Fixture',
          exchange: 'SZSE',
          listDate: '19930505',
          listStatus: 'L',
        },
      });
      const source = {
        call: vi.fn(async (_api: string) => [{ ts_code: newCode, trade_date: date, ...bar }]),
      };
      const result = await acceptSource(database, source, {
        dataset: 'stock-prices',
        scope: 'all',
        startDate: date,
        endDate: date,
      });
      expect(source.call.mock.calls.map(([api]) => api)).toEqual(['daily']);
      expect(result.prepared.status).toBe('complete');
      expect(await database.daily.findFirst()).toMatchObject({ tsCode: newCode, close: bar.close });
    }));

  it('does not infer suspension or prices from a complete empty response', async () =>
    withSyncDatabase(async (database) => {
      const source = { call: vi.fn(async (_api: string) => []) };
      const result = await acceptSource(database, source, {
        dataset: 'stock-prices',
        scope: 'all',
        startDate: date,
        endDate: date,
      });
      expect(source.call.mock.calls.map(([api]) => api)).toEqual(['daily']);
      expect(result.prepared.status).toBe('complete');
      expect(result.prepared.errors).toEqual([]);
      expect(await database.daily.count()).toBe(0);
    }));

  it('keeps independent histories when a preferred name interval conflicts', async () =>
    withSyncDatabase(async (database) => {
      const common = { start_date: '20180101', end_date: null, ann_date: '20180101' };
      const result = await acceptSource(
        database,
        {
          call: async () => [
            { ...common, ts_code: newCode, name: 'one' },
            { ...common, ts_code: newCode, name: 'two' },
            { ...common, ts_code: '600000.SH', name: 'independent' },
          ],
        },
        { dataset: 'stock-names', scope: 'all', startDate: '20180101', endDate: '20181231' },
      );
      expect(result.prepared.errors).toHaveLength(1);
      expect(await database.stockNameHistory.findMany()).toMatchObject([
        { tsCode: '600000.SH', name: 'independent' },
      ]);
    }));

  it.each([false, true])(
    'keeps name intervals while selecting sources, reversed=%s',
    async (reversed) =>
      withSyncDatabase(async (database) => {
        const common = { start_date: '20180101', end_date: null, ann_date: '20180101' };
        const rows = [
          { ts_code: oldCode, name: '旧口径', ...common },
          { ts_code: newCode, name: '新口径', ...common },
          {
            ts_code: oldCode,
            name: '历史名称',
            start_date: '20100101',
            end_date: '20171231',
            ann_date: '20100101',
          },
        ];
        const partition = {
          dataset: 'stock-names',
          scope: 'all',
          startDate: '20100101',
          endDate: '20181231',
        };
        const first = await acceptSource(
          database,
          { call: async () => (reversed ? [...rows].reverse() : rows) },
          partition,
        );
        expect(first.accepted.errors).toEqual([]);
        await acceptSource(database, { call: async () => [rows[0], rows[2]] }, partition);
        const stored = await database.stockNameHistory.findMany({ orderBy: { startDate: 'asc' } });
        expect(stored).toMatchObject([
          { name: '历史名称' },
          { name: '新口径', sourceTsCode: newCode },
        ]);
        const lookup = new StockNameLookup(stored);
        expect(lookup.at(oldCode, '20170101').name).toBe('历史名称');
        expect(lookup.at(oldCode, '20180101').name).toBe('新口径');
      }),
  );
});
