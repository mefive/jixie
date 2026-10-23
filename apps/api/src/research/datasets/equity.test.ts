import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { loadResearchCrossSection, loadResearchPanel } from './equity.js';

describe('Research equity datasets', () => {
  it('loads a fixed-schema point-in-time index cross-section without current-name leakage', async () =>
    withSyncDatabase(async (database) => {
      await seedFixture(database);
      const result = await loadResearchCrossSection(
        {
          universe: 'index:000300.SH',
          date: '20240203',
          minimum_listed_days: 0,
          risk_warning: 'exclude',
        },
        database,
      );

      expect(result.rows).toEqual([
        expect.objectContaining({
          date: '20240131',
          code: 'AAA.SH',
          name: 'Alpha',
          industry: 'Bank',
          close: 10,
          adjusted_close: 12,
          amount_cny_1k: 1_000,
          pe_ttm: 8,
        }),
      ]);
      expect(result.metadata).toMatchObject({
        kind: 'cross_section',
        dataRevision: 7,
        rowCount: 1,
        periods: [
          {
            requestedDate: '20240203',
            dataDate: '20240131',
            membershipAsOfDate: '20240131',
            rows: 1,
          },
        ],
      });
      expect(result.metadata.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'UNIVERSE_PREVIOUS_TRADING_DAY',
      );
    }));

  it("builds completed month ends with each date's historical index membership", async () =>
    withSyncDatabase(async (database) => {
      await seedFixture(database);
      const result = await loadResearchPanel(
        {
          universe: 'index:000300.SH',
          start: '20240101',
          end: '20240315',
          frequency: 'month_end',
          minimum_listed_days: 0,
          risk_warning: 'include',
        },
        database,
      );

      expect(result.rows.map((row) => `${row.date}:${row.code}`)).toEqual([
        '20240131:AAA.SH',
        '20240131:BBB.SH',
        '20240229:BBB.SH',
        '20240229:CCC.SH',
      ]);
      expect(
        result.rows.find((row) => row.date === '20240229' && row.code === 'BBB.SH'),
      ).toMatchObject({ name: 'Beta', adjusted_close: 24 });
      expect(result.metadata).toMatchObject({
        kind: 'panel',
        rowCount: 4,
        periods: [
          { requestedDate: '20240131', membershipAsOfDate: '20240131', rows: 2 },
          { requestedDate: '20240229', membershipAsOfDate: '20240229', rows: 2 },
        ],
      });
    }));

  it('stops loading a panel as soon as a caller-specific row budget is exceeded', async () =>
    withSyncDatabase(async (database) => {
      await seedFixture(database);
      await expect(
        loadResearchPanel(
          {
            universe: 'index:000300.SH',
            start: '20240101',
            end: '20240315',
            frequency: 'month_end',
            minimum_listed_days: 0,
            risk_warning: 'include',
          },
          database,
          { maxPanelRows: 3 },
        ),
      ).rejects.toThrow('exceeds the 3-row limit');
    }));
});

async function seedFixture(database: PrismaClient): Promise<void> {
  await database.stockBasic.createMany({
    data: [stock('AAA.SH', 'Alpha'), stock('BBB.SH', 'Beta'), stock('CCC.SH', 'Gamma')],
  });
  await database.stockNameHistory.createMany({
    data: [
      { tsCode: 'AAA.SH', name: 'Alpha', startDate: '20200101' },
      { tsCode: 'BBB.SH', name: 'ST Beta', startDate: '20200101', endDate: '20240215' },
      { tsCode: 'BBB.SH', name: 'Beta', startDate: '20240216' },
      { tsCode: 'CCC.SH', name: 'Gamma', startDate: '20200101' },
    ],
  });
  await database.swIndustryMember.createMany({
    data: [
      industry('AAA.SH', 'Bank'),
      industry('BBB.SH', 'Technology'),
      industry('CCC.SH', 'Industrial'),
    ],
  });
  await database.indexWeight.createMany({
    data: [
      { indexCode: '000300.SH', conCode: 'AAA.SH', tradeDate: '20240131' },
      { indexCode: '000300.SH', conCode: 'BBB.SH', tradeDate: '20240131' },
      { indexCode: '000300.SH', conCode: 'BBB.SH', tradeDate: '20240229' },
      { indexCode: '000300.SH', conCode: 'CCC.SH', tradeDate: '20240229' },
    ],
  });
  await database.tradeCal.createMany({
    data: [
      { exchange: 'SSE', calDate: '20240131', isOpen: 1 },
      { exchange: 'SSE', calDate: '20240203', isOpen: 0 },
      { exchange: 'SSE', calDate: '20240229', isOpen: 1 },
      { exchange: 'SSE', calDate: '20240315', isOpen: 1 },
    ],
  });
  await database.dailyBasic.createMany({
    data: [
      dailyBasic('AAA.SH', '20240131', 8, 100),
      dailyBasic('BBB.SH', '20240131', 12, 200),
      dailyBasic('BBB.SH', '20240229', 11, 220),
      dailyBasic('CCC.SH', '20240229', 15, 180),
    ],
  });
  await database.daily.createMany({
    data: [
      daily('AAA.SH', '20240131', 10, 1_000),
      daily('BBB.SH', '20240131', 20, 2_000),
      daily('BBB.SH', '20240229', 20, 2_100),
      daily('CCC.SH', '20240229', 30, 1_800),
    ],
  });
  await database.adjFactor.createMany({
    data: [
      { tsCode: 'AAA.SH', tradeDate: '20240131', adjFactor: 1.2 },
      { tsCode: 'BBB.SH', tradeDate: '20240131', adjFactor: 1.1 },
      { tsCode: 'BBB.SH', tradeDate: '20240229', adjFactor: 1.2 },
      { tsCode: 'CCC.SH', tradeDate: '20240229', adjFactor: 1.1 },
    ],
  });
  await database.marketDataState.create({ data: { key: 'global', revision: 7 } });
  await database.datasetSyncPartition.createMany({
    data: ['20240131', '20240229'].flatMap((date) =>
      ['calendar', 'stock-prices', 'stock-adjustments', 'stock-valuations', 'index-weights'].map(
        (dataset) => ({
          id: `${dataset}:${date}`,
          dataset,
          scope: dataset === 'calendar' ? 'SSE' : dataset === 'index-weights' ? '000300.SH' : 'all',
          startDate: date,
          endDate: date,
          status: 'complete',
          policyVersion: 'sync-v1',
        }),
      ),
    ),
  });
}

function stock(tsCode: string, name: string) {
  return {
    tsCode,
    symbol: tsCode.split('.')[0]!,
    name,
    listDate: '20100101',
    listStatus: 'L',
  };
}

function industry(tsCode: string, l1Name: string) {
  return { tsCode, l1Code: `I-${tsCode}`, l1Name, inDate: '20200101' };
}

function dailyBasic(tsCode: string, tradeDate: string, peTtm: number, totalMv: number) {
  return {
    tsCode,
    tradeDate,
    pe: peTtm,
    peTtm,
    pb: 1,
    ps: 2,
    dvRatio: 3,
    totalMv,
    circMv: totalMv * 0.8,
    turnoverRate: 1.5,
  };
}

function daily(tsCode: string, tradeDate: string, close: number, amount: number) {
  return { tsCode, tradeDate, close, pctChg: 1, vol: 100, amount };
}
