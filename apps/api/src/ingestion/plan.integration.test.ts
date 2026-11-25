import { planEtfSeries } from './etf-plan.js';
import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections } from '../../tests/ingestion-source.js';
import {
  financialIndicatorUnits,
  planEtfSelections,
  planIngestion,
  referenceUnits,
} from './plan.js';

it('plans whole ETF and name-history ranges without calendar-year boundaries', async () =>
  withSyncDatabase(async (database) => {
    await emptySelections(database);
    await database.ingestionSelection.update({
      where: { assetType: 'etf' },
      data: { codes: ['510000.SH'] },
    });
    await database.etfBasic.create({
      data: {
        tsCode: '510000.SH',
        name: 'Range fixture',
        exchange: 'SH',
        listDate: '20100101',
        listStatus: 'L',
        sameDayTurnover: false,
      },
    });
    const startedAt = new Date('2026-11-06T10:00:00Z');
    const plan = await planIngestion('20221001', startedAt);

    expect(plan.units.filter(({ dataset }) => dataset === 'etf-prices')).toMatchObject([
      { startDate: '20100101', endDate: '20221001', adaptiveRange: true },
    ]);
    expect(plan.units.filter(({ dataset }) => dataset === 'stock-names')).toHaveLength(1);
    expect(
      referenceUnits('20221001', startedAt).filter(({ dataset }) => dataset === 'calendar'),
    ).toHaveLength(3);
  }));

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
    const plan = await planIngestion('20180103', new Date('2018-01-04T10:00:00Z'));
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

it('plans exactly 124 quarterly financial-indicator batches from 1988 through 2018', () => {
  const units = financialIndicatorUnits('20181231', new Date('2019-01-01T10:00:00Z'));
  expect(units).toHaveLength(124);
  expect(new Set(units.map((unit) => unit.period)).size).toBe(124);
  expect(units[0]).toMatchObject({
    api: 'fina_indicator_vip',
    scope: 'all',
    period: '19880331',
    catalogThrough: '20181231',
  });
  expect(units.at(-1)).toMatchObject({
    api: 'fina_indicator_vip',
    scope: 'all',
    period: '20181231',
  });
  expect(units.every((unit) => unit.period >= '19880101' && unit.period <= '20181231')).toBe(true);
});

it('respects partial-quarter and fixed-origin boundaries without planning earlier history', () => {
  const clock = new Date('2019-01-01T10:00:00Z');
  expect(financialIndicatorUnits('19871231', clock)).toEqual([]);
  expect(financialIndicatorUnits('19880330', clock)).toEqual([]);
  const first = financialIndicatorUnits('19880331', clock);
  expect(first).toHaveLength(1);
  expect(first.every((unit) => unit.period === '19880331')).toBe(true);
  const beforeQuarterEnd = financialIndicatorUnits('20181231', new Date('2018-12-31T10:00:00Z'));
  expect(beforeQuarterEnd.some((unit) => unit.period === '20181231')).toBe(false);
});

it('plans two ETF batches per new session and reuses only the membership covered by a complete receipt', async () =>
  withSyncDatabase(async (database) => {
    const existing = ['510001.SH', '510002.SH'];
    const newcomer = '510003.SH';
    const dates = Array.from(
      { length: 20 },
      (_, index) => '202001' + String(index + 2).padStart(2, '0'),
    );
    await database.ingestionSelection.create({
      data: { assetType: 'etf', codes: [...existing, newcomer] },
    });
    await database.etfBasic.createMany({
      data: [...existing, newcomer].map((tsCode) => ({
        tsCode,
        name: tsCode,
        exchange: 'SH',
        listDate: '20180101',
        listStatus: 'L',
        sameDayTurnover: false,
      })),
    });
    await database.tradeCal.createMany({
      data: dates.map((calDate) => ({ exchange: 'SSE', calDate, isOpen: 1 })),
    });
    await database.ingestionRun.create({
      data: {
        id: 'prior',
        targetDate: '20200101',
        status: 'completed',
        trigger: 'manual',
        scopeSnapshot: {},
      },
    });
    const receipt = {
      runId: 'prior',
      status: 'succeeded',
      responseComplete: true,
      request: {},
      rangeStart: '20180101',
      rangeEnd: '20200101',
      period: 'legacy',
    };
    for (const [dataset, api] of [
      ['etf-prices', 'fund_daily'],
      ['etf-adjustments', 'fund_adj'],
    ]) {
      await database.ingestionBatch.createMany({
        data: existing.map((scope) => ({ ...receipt, id: dataset + scope, dataset, api, scope })),
      });
    }

    const end = dates[19];
    const { units } = await planEtfSeries(end);
    const daily = units.filter((unit) => unit.etfCodes);
    expect(daily).toHaveLength(40);
    expect(daily.every((unit) => JSON.stringify(unit.etfCodes) === JSON.stringify(existing))).toBe(
      true,
    );
    expect(units.filter((unit) => unit.scope === newcomer)).toMatchObject([
      { dataset: 'etf-prices', startDate: '20180101', endDate: end },
      { dataset: 'etf-adjustments', startDate: '20180101', endDate: end },
    ]);

    const first = daily[0];
    await database.ingestionBatch.create({
      data: {
        ...receipt,
        id: 'day',
        dataset: first.dataset,
        scope: first.scope,
        period: first.period,
        rangeStart: first.startDate,
        rangeEnd: first.endDate,
        api: first.api,
        request: { etfCodes: existing },
      },
    });
    await database.ingestionBatch.create({
      data: { ...receipt, id: 'added', dataset: first.dataset, api: first.api, scope: newcomer },
    });
    const next = await planEtfSeries(end);

    expect(
      next.units.filter((unit) => unit.dataset === first.dataset && unit.period === first.period),
    ).toMatchObject([{ etfCodes: [newcomer] }]);
  }));
