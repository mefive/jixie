import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../tests/sync-database.js';
import { emptySelections } from '../../tests/ingestion-source.js';
import { planIngestion } from './plan.js';

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
