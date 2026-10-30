import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { acceptSource, proveRange, seedSessions } from '../../../tests/market-contract-fixtures.js';

const date = '20260916';
const bar = {
  ts_code: '920298.BJ',
  trade_date: date,
  open: 10,
  high: 12,
  low: 9,
  close: 11,
  vol: 1,
  amount: 1,
};

describe('stock maintenance through the formal domain path', () => {
  it('accepts historical directory identities and an unbounded IPO price interval', async () =>
    withSyncDatabase(async (database) => {
      const directory = await acceptSource(
        database,
        {
          call: async () => [
            {
              ts_code: 'T600018.SH',
              symbol: 'T600018',
              name: '上港集箱',
              list_status: 'D',
              list_date: '20000719',
              delist_date: '20061026',
            },
          ],
        },
        { dataset: 'stock-master', scope: 'D', startDate: date, endDate: date },
      );
      expect(directory.accepted.rejected).toBe(0);
      expect(await database.stockBasic.count()).toBe(1);
      await seedSessions(database, date);
      await database.daily.create({ data: { tsCode: bar.ts_code, tradeDate: date, close: 11 } });
      await proveRange(database, {
        dataset: 'stock-prices',
        scope: 'all',
        startDate: date,
        endDate: date,
      });
      const limits = await acceptSource(
        database,
        {
          call: async () => [
            { ts_code: bar.ts_code, trade_date: date, up_limit: 99999.99, down_limit: 0 },
          ],
        },
        { dataset: 'stock-limits', scope: 'all', startDate: date, endDate: date },
      );
      expect(limits.prepared.status).toBe('complete');
      expect(await database.stkLimit.findFirst()).toMatchObject({
        upLimit: 99999.99,
        downLimit: 0,
      });
    }));

  it('keeps known rows on a truncated response and refuses wrong-session records', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, date);
      for (const scope of ['L', 'D', 'P', 'G']) {
        await proveRange(database, {
          dataset: 'stock-master',
          scope,
          startDate: date,
          endDate: date,
        });
      }
      await database.stockBasic.createMany({
        data: [bar.ts_code, '600000.SH'].map((tsCode) => ({
          tsCode,
          symbol: tsCode.slice(0, 6),
          name: tsCode,
          listStatus: 'L',
          listDate: '20150101',
        })),
      });
      await database.daily.create({ data: { tsCode: '600000.SH', tradeDate: date, close: 20 } });
      const partition = { dataset: 'stock-prices', scope: 'all', startDate: date, endDate: date };
      const first = await acceptSource(
        database,
        { call: async (api) => (api === 'suspend_d' ? [] : [bar]) },
        partition,
      );
      expect(first.prepared.status).toBe('partial');
      expect(first.accepted.deleted).toBe(0);
      expect(await database.daily.count()).toBe(2);
      const wrongDate = await acceptSource(
        database,
        { call: async (api) => (api === 'suspend_d' ? [] : [{ ...bar, trade_date: '20260917' }]) },
        partition,
      );
      expect(wrongDate.prepared.errors.length).toBeGreaterThan(0);
      expect(wrongDate.accepted.inserted).toBe(0);
      expect(await database.daily.count()).toBe(2);
    }));
});
