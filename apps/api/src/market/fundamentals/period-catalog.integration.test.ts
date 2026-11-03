import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { prepareFinancialPeriodCatalog } from './period-catalog.js';

it('discovers actual periods including pre-IPO and non-quarter-end history, filtering future listings', async () =>
  withSyncDatabase(async (database) => {
    await database.stockBasic.createMany({
      data: [
        {
          tsCode: '600000.SH',
          symbol: '600000',
          name: 'Eligible',
          listStatus: 'L',
          exchange: 'SSE',
          listDate: '19901219',
        },
        {
          tsCode: '600001.SH',
          symbol: '600001',
          name: 'Future',
          listStatus: 'L',
          exchange: 'SSE',
          listDate: '20200101',
        },
      ],
    });
    const catalog = await prepareFinancialPeriodCatalog(
      {
        call: async (_api, params, fields) => {
          expect(params).toMatchObject({ report_type: '1', limit: 5000, offset: 0 });
          expect(params).not.toHaveProperty('ts_code');
          expect(params).not.toHaveProperty('period');
          expect(fields).toBe('ts_code,end_date');

          return [
            { ts_code: '600000.SH', end_date: '19881231' },
            { ts_code: '600000.SH', end_date: '19881231' },
            { ts_code: '600000.SH', end_date: '19900815' },
            { ts_code: '600000.SH', end_date: '20201231' },
            { ts_code: '600001.SH', end_date: '19871231' },
          ];
        },
      },
      'income|1',
      '20181231',
    );
    expect(catalog.status).toBe('complete');
    expect(catalog.observedDates).toEqual(['19881231', '19900815']);
    expect(catalog.checks.excludedRows).toBe(3);
  }));
