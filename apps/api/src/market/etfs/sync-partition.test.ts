import { prepareEtfPartition } from './sync-partition.js';
import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { acceptSource, seedSessions } from '../../../tests/market-contract-fixtures.js';

const partition = {
  dataset: 'etf-prices',
  scope: '510300.SH',
  startDate: '20260915',
  endDate: '20260916',
};
const bar = {
  ts_code: partition.scope,
  trade_date: '20260915',
  open: 1,
  high: 2,
  low: 1,
  close: 2,
};

describe('ETF formal maintenance validation', () => {
  it('rejects a new ETF with missing fund classification while retaining classified rows', async () =>
    withSyncDatabase(async (database) => {
      const catalog = [
        {
          ts_code: '158008.OF',
          extname: '华夏国证储能电池ETF',
          list_status: 'L',
          list_date: '20260828',
          exchange: 'SZ',
          etf_type: '纯境内',
        },
        {
          ts_code: '510300.SH',
          extname: '沪深300ETF',
          list_status: 'L',
          list_date: '20120528',
          exchange: 'SH',
          etf_type: '纯境内',
        },
      ];
      const result = await acceptSource(
        database,
        {
          call: async (api) =>
            api === 'etf_basic' ? catalog : [{ ts_code: '510300.SH', fund_type: '股票型' }],
        },
        { dataset: 'etf-master', scope: 'all', startDate: '20261030', endDate: '20261030' },
      );

      expect(result.accepted.rejected).toBe(1);
      expect(result.accepted.errors.join(' ')).toContain('sameDayTurnover');
      expect(await database.etfBasic.findMany()).toMatchObject([
        { tsCode: '510300.SH', sameDayTurnover: false },
      ]);
      expect(await database.etfBasic.count()).toBe(1);
    }));

  it.each<Record<string, number>>([{ close: 1 }, { open: 0, high: 1, low: 1, close: 1 }])(
    'rejects missing or nonpositive OHLC: %j',
    async (prices) =>
      withSyncDatabase(async (database) => {
        await database.etfDaily.create({
          data: { tsCode: partition.scope, tradeDate: '20260915', close: 9 },
        });
        const result = await acceptSource(
          database,
          { call: async () => [{ ts_code: partition.scope, trade_date: '20260915', ...prices }] },
          partition,
        );
        expect(result.prepared.status).toBe('error');
        expect(result.accepted.deleted).toBe(0);
        expect(await database.etfDaily.findFirst()).toMatchObject({ close: 9 });
      }),
  );

  it('preserves sparse source responses without fabricating prices and repeats without writes', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, partition.startDate, partition.endDate);
      const partial = await acceptSource(database, { call: async () => [bar] }, partition);
      expect(partial.prepared.status).toBe('complete');
      expect(partial.prepared.observedDates).not.toContain('20260916');
      expect(partial.prepared.tables[0].records).toHaveLength(1);
      expect(partial.accepted.inserted).toBe(1);
      const source = { call: async () => [bar, { ...bar, trade_date: '20260916' }] };
      const full = await acceptSource(database, source, partition);
      expect(full.prepared.status).toBe('complete');
      const repeated = await acceptSource(database, source, partition);
      expect(repeated.accepted.changed).toBe(false);
      expect(await database.etfDaily.count()).toBe(2);
    }));
});

it('admits only selected daily ETF rows, updates prices and preserves absent members', async () =>
  withSyncDatabase(async (database) => {
    const daily = {
      ...partition,
      scope: 'daily-selection',
      endDate: partition.startDate,
      etfCodes: [partition.scope, '510001.SH'],
    };
    await database.etfDaily.createMany({
      data: daily.etfCodes.map((tsCode) => ({
        tsCode,
        tradeDate: daily.startDate,
        close: 9,
      })),
    });

    const result = await acceptSource(
      database,
      {
        call: async (api, params) => {
          expect(api).toBe('fund_daily');
          expect(params).toEqual({ trade_date: daily.startDate, limit: 5000, offset: 0 });
          return [bar, { ...bar, ts_code: '510999.SH', close: -1 }];
        },
      },
      daily,
    );

    expect(result.prepared.checks.excludedRows).toBe(1);
    expect(result.accepted.updated).toBe(1);
    expect(result.accepted.rejected).toBe(0);
    expect(
      await database.etfDaily.findMany({
        orderBy: { tsCode: 'asc' },
        select: { tsCode: true, close: true },
      }),
    ).toEqual([
      { tsCode: '510001.SH', close: 9 },
      { tsCode: partition.scope, close: 2 },
    ]);
  }));

it('rejects incomplete or overlapping pages for a full-market adjustment date', async () => {
  const daily = {
    ...partition,
    dataset: 'etf-adjustments',
    scope: 'daily-selection',
    endDate: partition.startDate,
    etfCodes: [partition.scope],
  };
  const page = Array.from({ length: 2000 }, (_, index) => ({
    ts_code: `${510000 + index}.SH`,
    trade_date: daily.startDate,
    adj_factor: 1,
  }));
  const incomplete = await prepareEtfPartition(
    {
      call: async (_api, params) => {
        if (params?.offset) {
          throw new Error('page unavailable');
        }
        return page;
      },
    },
    daily,
  );
  expect(incomplete.checks.terminalPage).toBe(false);
  expect(incomplete.checks.sourceFailed).toBe(true);
  await expect(
    prepareEtfPartition(
      { call: async (_api, params) => (params?.offset ? [page[0]] : page) },
      daily,
    ),
  ).rejects.toThrow('overlapping pages');
});
