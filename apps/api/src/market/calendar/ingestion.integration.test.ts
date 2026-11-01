import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { acceptSource } from '../../../tests/market-contract-fixtures.js';

it('accepts sparse and empty calendar history without fabricating days or deleting known entries', async () =>
  withSyncDatabase(async (database) => {
    await database.tradeCal.create({ data: { exchange: 'SZSE', calDate: '19910704', isOpen: 1 } });
    const unit = { dataset: 'calendar', scope: 'SZSE', startDate: '19910101', endDate: '19911231' };
    const first = await acceptSource(
      database,
      { call: async () => [{ exchange: 'SZSE', cal_date: '19910703', is_open: 1 }] },
      unit,
    );
    expect(first.prepared.status).toBe('complete');
    expect(first.prepared.errors).toEqual([]);
    expect(
      await database.tradeCal.findMany({ orderBy: { calDate: 'asc' }, select: { calDate: true } }),
    ).toEqual([{ calDate: '19910703' }, { calDate: '19910704' }]);
    const empty = await acceptSource(database, { call: async () => [] }, unit);
    expect(empty.prepared.status).toBe('complete');
    expect(empty.prepared.errors).toEqual([]);
    expect(await database.tradeCal.count()).toBe(2);
  }));
