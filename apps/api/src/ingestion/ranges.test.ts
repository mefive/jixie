import { expect, it } from 'vitest';
import { replaceRangeUnit, splitRangeUnit, uncoveredRangeUnits } from './ranges.js';
import type { IngestionUnit } from './schema.js';

const unit: IngestionUnit = {
  dataset: 'etf-prices',
  scope: '510000.SH',
  api: 'fund_daily',
  period: 'range/20180101/20221001',
  startDate: '20180101',
  endDate: '20221001',
  adaptiveRange: true,
  refresh: false,
};
const receipt = (start: string, end: string) => ({
  dataset: unit.dataset,
  scope: unit.scope,
  status: 'succeeded',
  responseComplete: true,
  rejectedCount: 0,
  rangeStart: start,
  rangeEnd: end,
  sourceStart: null,
  startedAt: new Date('2026-11-06T10:00:00Z'),
});

it('keeps a single multi-year request until actual source limits require splitting', () => {
  expect(uncoveredRangeUnits(unit, [])).toEqual([unit]);
  const children = splitRangeUnit(unit);

  expect(children).toHaveLength(2);
  expect(children[0].startDate).toBe(unit.startDate);
  expect(children[1].endDate).toBe(unit.endDate);
  expect(children[0].endDate < children[1].startDate).toBe(true);
  expect(() => splitRangeUnit({ ...unit, startDate: unit.endDate })).toThrow();
});

it('unions overlapping legacy year/month receipts and requests only continuous gaps', () => {
  const receipts = [
    receipt('20180101', '20181231'),
    receipt('20181201', '20191231'),
    receipt('20200201', '20211231'),
    receipt('20220101', '20220930'),
  ];
  expect(uncoveredRangeUnits(unit, receipts)).toMatchObject([
    { startDate: '20200101', endDate: '20200131' },
    { startDate: '20221001', endDate: '20221001' },
  ]);
  expect(uncoveredRangeUnits(unit, [receipt(unit.startDate, unit.endDate)])).toEqual([]);
});

it('does not use failed, partial, truncated or rejected ranges as coverage', () => {
  const complete = receipt(unit.startDate, unit.endDate);
  for (const invalid of [
    { status: 'failed' },
    { status: 'partial' },
    { responseComplete: false },
    { rejectedCount: 1 },
  ]) {
    expect(uncoveredRangeUnits(unit, [{ ...complete, ...invalid }])).toEqual([unit]);
  }
});

it('refreshes calendar dates from capture day while preserving earlier coverage', () => {
  const calendar = {
    ...unit,
    dataset: 'calendar',
    scope: 'SSE',
    startDate: '20261101',
    endDate: '20261201',
  };
  const prior = { ...receipt('20261101', '20261201'), dataset: 'calendar', scope: 'SSE' };

  expect(uncoveredRangeUnits(calendar, [prior])).toMatchObject([
    { startDate: '20261106', endDate: '20261201' },
  ]);
});

it('replaces only the requested unit in the frozen plan and preserves siblings', () => {
  const sibling = { ...unit, scope: 'other' };
  const children = splitRangeUnit(unit);
  const replaced = replaceRangeUnit(
    { version: 2, referenceUnits: [], plan: { units: [unit, sibling], blocked: [] } },
    unit,
    children,
  );

  expect(replaced.plan?.units).toEqual([...children, sibling]);
});
