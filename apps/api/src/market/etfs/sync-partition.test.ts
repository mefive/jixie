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

  it.each<Record<string, number>>([{ close: 1 }, { open: 1, high: 1, low: 2, close: 3 }])(
    'rejects missing or impossible OHLC: %j',
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

  it('keeps valid partial data, proves complete dates, and repeats without writes', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, partition.startDate, partition.endDate);
      const partial = await acceptSource(database, { call: async () => [bar] }, partition);
      expect(partial.prepared.status).toBe('partial');
      expect(partial.accepted.inserted).toBe(1);
      const source = { call: async () => [bar, { ...bar, trade_date: '20260916' }] };
      const full = await acceptSource(database, source, partition);
      expect(full.prepared.status).toBe('complete');
      const repeated = await acceptSource(database, source, partition);
      expect(repeated.accepted.changed).toBe(false);
      expect(await database.etfDaily.count()).toBe(2);
    }));
});
