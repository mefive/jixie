import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { acceptSource, seedSessions } from '../../../tests/market-contract-fixtures.js';

const partition = {
  dataset: 'index-weights',
  scope: '000300.SH',
  startDate: '20260901',
  endDate: '20260930',
};
const member = {
  index_code: partition.scope,
  con_code: '001872.SZ',
  trade_date: partition.endDate,
  weight: 60,
};
const other = { ...member, con_code: '600000.SH', weight: 40 };

describe('index constituent source selection', () => {
  it.each([false, true])(
    'selects before snapshot totals and preserves the source across runs: %s',
    async (reversed) =>
      withSyncDatabase(async (database) => {
        await seedSessions(database, partition.startDate, partition.endDate);
        const rows = [{ ...member, con_code: '000022.SZ', weight: 70 }, member, other];
        const first = await acceptSource(
          database,
          { call: async () => (reversed ? [...rows].reverse() : rows) },
          partition,
        );
        expect(first.prepared.status).toBe('complete');
        expect(first.accepted.errors).toEqual([]);
        expect(await database.indexWeight.findMany({ orderBy: { conCode: 'asc' } })).toMatchObject([
          { conCode: '001872.SZ', sourceTsCode: '001872.SZ', weight: 60 },
          { conCode: '600000.SH', weight: 40 },
        ]);
        const repeated = await acceptSource(
          database,
          { call: async () => [other, member] },
          partition,
        );
        expect(repeated.accepted.changed).toBe(false);
        const oldOnly = await acceptSource(
          database,
          { call: async () => [{ ...member, con_code: '000022.SZ', weight: 61 }, other] },
          partition,
        );
        expect(oldOnly.accepted.changed).toBe(false);
      }),
  );

  it('rejects inconsistent retained totals after protecting a known successor', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, partition.startDate, partition.endDate);
      await acceptSource(database, { call: async () => [member, other] }, partition);
      const before = await database.indexWeight.findMany();
      const result = await acceptSource(
        database,
        {
          call: async () => [
            { ...member, con_code: '000022.SZ', weight: 80 },
            { ...other, weight: 20 },
          ],
        },
        partition,
      );
      expect(result.prepared.status).toBe('complete');
      expect(result.accepted.errors).toHaveLength(1);
      expect(await database.indexWeight.findMany()).toEqual(before);
    }));

  it('rejects duplicates within the preferred source without falling back', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, partition.startDate, partition.endDate);
      const result = await acceptSource(
        database,
        { call: async () => [{ ...member, con_code: '000022.SZ' }, member, member, other] },
        partition,
      );
      expect(result.prepared.status).toBe('error');
      expect(await database.indexWeight.count()).toBe(0);
    }));
});

it('queries the latest verified session within a partial month and preserves previous snapshots on empty data', async () =>
  withSyncDatabase(async (database) => {
    const window = { ...partition, startDate: '20190101', endDate: '20190120' };
    await seedSessions(database, window.startDate, window.endDate);
    await database.tradeCal.updateMany({
      where: { exchange: 'SSE', calDate: { gte: '20190119', lte: '20190120' } },
      data: { isOpen: 0 },
    });
    await database.indexWeight.create({
      data: {
        indexCode: partition.scope,
        conCode: '600000.SH',
        tradeDate: '20181228',
        weight: 100,
      },
    });
    const result = await acceptSource(
      database,
      {
        call: async (api, params) => {
          expect(api).toBe('index_weight');
          expect(params).toEqual({
            index_code: partition.scope,
            trade_date: '20190118',
            limit: 1000,
            offset: 0,
          });

          return [];
        },
      },
      window,
    );

    expect(result.prepared.status).toBe('complete');
    expect(result.accepted.changed).toBe(false);
    expect(await database.indexWeight.count()).toBe(1);
  }));

it('requires calendar evidence and keeps a failed second page from replacing a snapshot', async () =>
  withSyncDatabase(async (database) => {
    await expect(
      acceptSource(
        database,
        {
          call: async () => {
            throw new Error('Source must not be called without calendar evidence');
          },
        },
        partition,
      ),
    ).rejects.toThrow('complete verified SSE calendar');
    await seedSessions(database, partition.startDate, partition.endDate);
    const result = await acceptSource(
      database,
      {
        call: async (_api, params) => {
          if (params?.offset) {
            throw new Error('Controlled weight page failure');
          }

          return Array.from({ length: 1000 }, (_, index) => ({
            index_code: partition.scope,
            con_code: `${600000 + index}.SH`,
            trade_date: partition.endDate,
            weight: 0.1,
          }));
        },
      },
      partition,
    );

    expect(result.prepared.checks.terminalPage).toBe(false);
    expect(await database.indexWeight.count()).toBe(0);
  }));
