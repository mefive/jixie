import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { acceptSource } from '../../../tests/market-contract-fixtures.js';

const partition = {
  dataset: 'index-weights',
  scope: '000300.SH',
  startDate: '20260901',
  endDate: '20260930',
};
const member = {
  index_code: partition.scope,
  con_code: '001872.SZ',
  trade_date: '20260915',
  weight: 60,
};
const other = { ...member, con_code: '600000.SH', weight: 40 };

describe('index constituent source selection', () => {
  it.each([false, true])(
    'selects before snapshot totals and preserves the source across runs: %s',
    async (reversed) =>
      withSyncDatabase(async (database) => {
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
      const result = await acceptSource(
        database,
        { call: async () => [{ ...member, con_code: '000022.SZ' }, member, member, other] },
        partition,
      );
      expect(result.prepared.status).toBe('error');
      expect(await database.indexWeight.count()).toBe(0);
    }));
});
