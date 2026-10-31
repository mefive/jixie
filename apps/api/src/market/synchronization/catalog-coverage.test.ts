import { expect, it } from 'vitest';
import { changedListingIntervals } from './catalog-coverage.js';
import { stockCoverageIntervals } from '../instruments/market-range.js';

it('returns only changed boundary dates, including disjoint intervals', () => {
  const before = { startDate: '20200101', endDate: '20200110' };
  expect(changedListingIntervals(before, { startDate: '20200103', endDate: '20200108' })).toEqual([
    { startDate: '20200101', endDate: '20200102' },
    { startDate: '20200109', endDate: '20200110' },
  ]);
  expect(changedListingIntervals(before, { startDate: '20200201', endDate: '20200202' })).toEqual([
    before,
    { startDate: '20200201', endDate: '20200202' },
  ]);
  expect(changedListingIntervals(before, before)).toEqual([]);
});

it('revalidates the affected security range for a real exchange correction', () => {
  const interval = { startDate: '20200101', endDate: '20200110' };
  expect(
    changedListingIntervals({ ...interval, exchange: 'SSE' }, { ...interval, exchange: 'SZSE' }),
  ).toEqual([interval]);
  expect(
    changedListingIntervals({ ...interval, exchange: null }, { ...interval, exchange: 'SSE' }),
  ).toEqual([]);
});

it('excludes pending securities and preserves same-market predecessor history', () => {
  const base = { listStatus: 'L', listDate: '19930505', exchange: 'SZSE' };
  const before = stockCoverageIntervals([
    { ...base, tsCode: '000022.SZ', listStatus: 'D', delistDate: '20181225' },
    { ...base, tsCode: '001872.SZ', listDate: '20181226' },
    { ...base, tsCode: '000099.SZ', listStatus: 'UN' },
  ]);
  expect([...before.keys()]).toEqual(['001872.SZ']);
  expect(before.get('001872.SZ')).toMatchObject({ startDate: '20150101', endDate: undefined });
});
