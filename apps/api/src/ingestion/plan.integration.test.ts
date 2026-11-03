import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections } from '../../tests/ingestion-source.js';
import { financialUnits, planEtfSelections, planIngestion } from './plan.js';

it('uses available exchange sessions when listing dates precede calendar history', async () =>
  withSyncDatabase(async (database) => {
    await emptySelections(database);
    await database.stockBasic.createMany({
      data: [
        {
          tsCode: '000004.SZ',
          symbol: '000004',
          name: 'Early SZSE listing',
          exchange: 'SZSE',
          listDate: '19901201',
          listStatus: 'L',
        },
        {
          tsCode: '600000.SH',
          symbol: '600000',
          name: 'SSE listing',
          exchange: 'SSE',
          listDate: '19901219',
          listStatus: 'L',
        },
      ],
    });
    await database.tradeCal.createMany({
      data: [
        { exchange: 'SSE', calDate: '19901219', isOpen: 1 },
        { exchange: 'SSE', calDate: '19901220', isOpen: 0 },
        { exchange: 'SZSE', calDate: '19901220', isOpen: 0 },
      ],
    });
    const plan = await planIngestion('19901220', new Date('1990-12-21T10:00:00Z'));
    const dates = plan.units
      .filter((unit) => unit.dataset === 'stock-prices')
      .map((unit) => unit.startDate);
    expect(dates).not.toContain('19901201');
    expect(plan.blocked).toEqual([]);
    expect(dates).toContain('19901219');
    expect(dates).not.toContain('19901220');
  }));

it('uses the selected exchange calendar without borrowing SSE sessions', async () =>
  withSyncDatabase(async (database) => {
    await emptySelections(database);
    await database.stockBasic.create({
      data: {
        tsCode: '000004.SZ',
        symbol: '000004',
        name: 'SZSE fixture',
        exchange: 'SZSE',
        listDate: '19901201',
        listStatus: 'L',
      },
    });
    await database.tradeCal.createMany({
      data: [
        { exchange: 'SSE', calDate: '19901219', isOpen: 1 },
        { exchange: 'SZSE', calDate: '19901219', isOpen: 0 },
        { exchange: 'SSE', calDate: '19901220', isOpen: 0 },
        { exchange: 'SZSE', calDate: '19901220', isOpen: 1 },
      ],
    });
    const plan = await planIngestion('19901220', new Date('1990-12-21T10:00:00Z'));
    expect(plan.units.filter((unit) => unit.dataset === 'stock-prices')).toMatchObject([
      { scope: 'SZSE', exchanges: ['SZSE'], startDate: '19901220' },
    ]);
    expect(plan.blocked).toEqual([]);
  }));

it('treats missing BSE calendar history as normal absence instead of reusing SSE', async () =>
  withSyncDatabase(async (database) => {
    await emptySelections(database);
    await database.stockBasic.create({
      data: {
        tsCode: '920139.BJ',
        symbol: '920139',
        name: 'BSE fixture',
        exchange: 'BSE',
        listDate: '20221028',
        listStatus: 'L',
      },
    });
    await database.tradeCal.create({ data: { exchange: 'SSE', calDate: '20221028', isOpen: 1 } });
    const plan = await planIngestion('20221028', new Date('2022-10-29T10:00:00Z'));
    expect(plan.units.filter((unit) => unit.dataset === 'stock-prices')).toEqual([]);
    expect(plan.blocked).toEqual([]);
  }));

it('filters future listings before dependency checks and financial planning while including listing day', async () =>
  withSyncDatabase(async (database) => {
    await database.ingestionSelection.createMany({
      data: [
        { assetType: 'etf', codes: ['510000.SH'] },
        { assetType: 'index', codes: [] },
      ],
    });
    await database.stockBasic.createMany({
      data: [
        {
          tsCode: '600000.SH',
          symbol: '600000',
          name: 'Listing day',
          exchange: 'SSE',
          listDate: '20180103',
          listStatus: 'L',
        },
        {
          tsCode: '600001.SH',
          symbol: '600001',
          name: 'Future listing with incomplete delisting metadata',
          exchange: 'SSE',
          listDate: '20200101',
          listStatus: 'D',
        },
      ],
    });
    await database.etfBasic.create({
      data: {
        tsCode: '510000.SH',
        name: 'Future delisted ETF without a known delisting date',
        exchange: 'SH',
        listDate: '20200101',
        listStatus: 'D',
        sameDayTurnover: false,
      },
    });
    await database.tradeCal.create({
      data: { exchange: 'SSE', calDate: '20180103', isOpen: 1 },
    });
    const plan = await planIngestion('20180103', new Date('2018-01-04T10:00:00Z'), {
      'income|1': ['20171231'],
    });
    expect(plan.blocked).toEqual([]);
    expect(plan.units.some((unit) => unit.dataset === 'etf-prices')).toBe(false);
    expect(plan.units.some((unit) => unit.scope.includes('600001.SH'))).toBe(false);
    expect(plan.units.some((unit) => unit.dataset === 'stock-prices')).toBe(true);
    expect(
      plan.units
        .filter((unit) => unit.dataset === 'financial-statements')
        .map((unit) => unit.scope),
    ).toContain('income|1');
    expect(
      plan.units.filter((unit) => unit.dataset === 'dividends').map((unit) => unit.scope),
    ).toEqual(['600000.SH']);
  }));

it('plans daily selections from each ETF venue calendar without future or borrowed sessions', async () =>
  withSyncDatabase(async (database) => {
    await database.etfBasic.createMany({
      data: [
        { tsCode: '510000.SH', exchange: 'SH', listDate: '20180102' },
        { tsCode: '159000.SZ', exchange: 'SZ', listDate: '20180103' },
        { tsCode: '510001.SH', exchange: 'SH', listDate: '20200101' },
      ].map((row) => ({ ...row, name: row.tsCode, listStatus: 'L', sameDayTurnover: false })),
    });
    await database.tradeCal.createMany({
      data: [
        { exchange: 'SSE', calDate: '20180101', isOpen: 1 },
        { exchange: 'SSE', calDate: '20180102', isOpen: 1 },
        { exchange: 'SSE', calDate: '20180103', isOpen: 1 },
        { exchange: 'SZSE', calDate: '20180104', isOpen: 1 },
        { exchange: 'SSE', calDate: '20180105', isOpen: 1 },
      ],
    });
    expect(await planEtfSelections('20180104', new Date('2018-01-05T10:00:00Z'))).toMatchObject([
      { period: '20180102', exchanges: ['SSE'] },
      { period: '20180103', exchanges: ['SSE'] },
      { period: '20180104', exchanges: ['SZSE'] },
    ]);
  }));

it('plans discovered pre-IPO and nonstandard periods without filling empty quarters or truncating history', () => {
  expect(
    financialUnits('20181231', new Date('2019-01-01T10:00:00Z'), {
      'income|1': ['19881231', '19900815', '20201231'],
      all: ['19871231'],
    }),
  ).toMatchObject([
    { scope: 'income|1', period: '19881231', catalogThrough: '20181231' },
    { scope: 'income|1', period: '19900815', catalogThrough: '20181231' },
    { dataset: 'financial-indicators', scope: 'all', period: '19871231' },
  ]);
});
