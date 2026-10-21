import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '#date';
import type { MarketChange } from './changes.js';
const database = vi.hoisted(() => ({
  daily: vi.fn(),
  factors: vi.fn(),
  prices: vi.fn(),
  weights: vi.fn(),
  industries: vi.fn(),
}));
vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    daily: { findMany: database.daily },
    adjFactor: { findMany: database.factors },
    indexDaily: { findMany: database.prices },
    indexWeight: { groupBy: database.weights },
    swIndustryMember: { findMany: database.industries },
  },
}));
import { affectsIndicators, planDerivedImpact, rollingEnd } from './impact.js';
let directory: string;
beforeEach(async () => {
  vi.resetAllMocks();
  directory = await mkdtemp(resolve(tmpdir(), 'jixie-impact-'));
  for (const query of Object.values(database)) {
    query.mockResolvedValue([]);
  }
});
afterEach(async () => rm(directory, { recursive: true, force: true }));
const dates = ['20260729', '20260730', '20260731', '20260803', '20260828', '20260831', '20260901'];
async function plan(
  table: string,
  changes: MarketChange[],
  calendar = dates,
  required: string[] = [],
) {
  await writeFile(
    resolve(directory, `${table}.changes`),
    changes.map((change) => JSON.stringify(change)).join('\n') + '\n',
  );

  return planDerivedImpact(
    directory,
    [{ table, count: changes.length, hash: 'fixture' }],
    calendar,
    required,
  );
}

describe('derived dependency bounds', () => {
  it.each(['StockBasic', 'StockNameHistory', 'StockCodeChange', 'SwIndexDaily'])(
    'ignores reference-only %s changes',
    (table) => {
      expect(affectsIndicators(table, { operation: 'insert', row: { name: 'new name' } })).toBe(
        false,
      );
    },
  );

  it('ignores unused bar and valuation fields but retains consumed fields', () => {
    const row = { tsCode: '000001.SZ', tradeDate: '20260731', close: 10, open: 9 };
    expect(
      affectsIndicators('Daily', { operation: 'update', before: row, row: { ...row, open: 8 } }),
    ).toBe(false);
    expect(
      affectsIndicators('Daily', { operation: 'update', before: row, row: { ...row, close: 11 } }),
    ).toBe(true);
    expect(
      affectsIndicators('DailyBasic', { operation: 'update', before: { pe: 10 }, row: { pe: 20 } }),
    ).toBe(false);
  });

  it('keeps turnover-only corrections on their date', async () => {
    const before = { tsCode: '000001.SZ', tradeDate: '20260731', turnoverRateF: 1 };
    const result = await plan('DailyBasic', [
      { operation: 'update', before, row: { ...before, turnoverRateF: 2 } },
    ]);
    expect(result.map(({ startDate, endDate }) => [startDate, endDate])).toEqual([
      ['20260731', '20260731'],
    ]);
    expect(database.daily).not.toHaveBeenCalled();
  });

  it.each(['insert', 'delete'] as const)(
    'bounds an index snapshot %s by its next replacement',
    async (operation) => {
      database.weights.mockResolvedValue([{ tradeDate: '20260701' }, { tradeDate: '20260831' }]);
      const result = await plan('IndexWeight', [
        {
          operation,
          row: { indexCode: '000300.SH', conCode: '000001.SZ', tradeDate: '20260731', weight: 100 },
        },
      ]);
      expect(result).toEqual([
        {
          startDate: '20260731',
          endDate: '20260828',
          scope: { market: false, industries: false, indexCodes: ['000300.SH'] },
        },
      ]);
    },
  );

  it('does not rewind an industry exit correction to its original entry date', async () => {
    const before = {
      tsCode: '000001.SZ',
      l1Code: '801010.SI',
      l1Name: 'Industry',
      inDate: '20150101',
      outDate: '20260731',
    };
    database.industries.mockResolvedValue([{ ...before, outDate: '20260831' }]);
    const result = await plan('SwIndustryMember', [
      { operation: 'update', before, row: { ...before, outDate: '20260831' } },
    ]);
    expect(result).toEqual([
      {
        startDate: '20260731',
        endDate: '20260828',
        scope: { market: false, industries: true, indexCodes: [] },
      },
    ]);
  });

  it('uses the same latest-entry selection when overlapping industry records change', async () => {
    const before = {
      tsCode: '000001.SZ',
      l1Code: '801010.SI',
      l1Name: 'Old',
      inDate: '20150101',
      outDate: null,
    };
    database.industries.mockResolvedValue([
      { ...before, l1Name: 'Changed' },
      { ...before, inDate: '20200101', l1Code: '801020.SI' },
    ]);
    expect(
      await plan('SwIndustryMember', [
        { operation: 'update', before, row: { ...before, l1Name: 'Changed' } },
      ]),
    ).toEqual([]);
  });

  it('propagates an adjusted-price correction through real observations across suspensions', async () => {
    const calendar = Array.from({ length: 150 }, (_, index) => addDays('20260101', index));
    const observations = calendar.filter((_, index) => index % 2 === 0);
    database.daily.mockResolvedValue(observations.map((tradeDate) => ({ tradeDate, close: 10 })));
    database.factors.mockResolvedValue(observations.map((tradeDate) => ({ tradeDate })));
    const before = { tsCode: '000001.SZ', tradeDate: observations[0], adjFactor: 1 };
    const result = await plan(
      'AdjFactor',
      [{ operation: 'update', before, row: { ...before, adjFactor: 2 } }],
      calendar,
    );
    expect(result.map(({ startDate, endDate }) => [startDate, endDate])).toEqual([
      [observations[0], observations[59]],
    ]);
  });

  it('retains both old and new rolling tails after deletions', () => {
    expect(
      rollingEnd('20260731', ['20260731', '20260803', '20260804'], ['20260803', '20260805'], 2),
    ).toBe('20260805');
  });

  it.each(['insert', 'delete'] as const)(
    'propagates stock row %s through the sixty-observation window',
    async (operation) => {
      const calendar = Array.from({ length: 65 }, (_, index) => addDays('20260101', index));
      const afterDates = operation === 'delete' ? calendar.slice(1) : calendar;
      database.daily.mockResolvedValue(afterDates.map((tradeDate) => ({ tradeDate, close: 10 })));
      database.factors.mockResolvedValue(calendar.map((tradeDate) => ({ tradeDate })));
      const result = await plan(
        'Daily',
        [
          {
            operation,
            row: { tsCode: '000001.SZ', tradeDate: calendar[0], close: 10 },
          },
        ],
        calendar,
      );
      expect(result.map(({ startDate, endDate }) => [startDate, endDate])).toEqual([
        [calendar[0], calendar[59]],
      ]);
    },
  );

  it('limits an index price deletion to that index and its twenty-row lag', async () => {
    const calendar = Array.from({ length: 25 }, (_, index) => addDays('20260101', index));
    database.prices.mockResolvedValue(calendar.slice(1).map((tradeDate) => ({ tradeDate })));
    expect(
      await plan(
        'IndexDaily',
        [
          {
            operation: 'delete',
            row: { tsCode: '000300.SH', tradeDate: calendar[0], close: 100 },
          },
        ],
        calendar,
      ),
    ).toEqual([
      {
        startDate: calendar[0],
        endDate: calendar[20],
        scope: { market: false, industries: false, indexCodes: ['000300.SH'] },
      },
    ]);
  });

  it('does not reread stock windows already covered by the required repair tail', async () => {
    await plan(
      'Daily',
      [
        {
          operation: 'insert',
          row: {
            tsCode: '000001.SZ',
            tradeDate: dates[0],
            close: 10,
          },
        },
      ],
      dates,
      dates,
    );
    expect(database.daily).not.toHaveBeenCalled();
    expect(database.factors).not.toHaveBeenCalled();
  });

  it('does not recompute older output dates for unchanged references during repair', async () => {
    const result = await plan(
      'StockBasic',
      [{ operation: 'insert', row: { tsCode: '000001.SZ', name: 'Name' } }],
      dates,
      ['20260731', '20260803'],
    );
    expect(result.map(({ startDate, endDate }) => [startDate, endDate])).toEqual([
      ['20260731', '20260803'],
    ]);
  });
});
