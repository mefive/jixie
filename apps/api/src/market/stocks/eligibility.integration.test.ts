import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { prepareStockPartition } from './sync-partition.js';
import { withImportDiagnostics, type ImportDiagnostics } from '../synchronization/diagnostics.js';

it('accepts independent auxiliary data without a price receipt and records unknown identities', async () =>
  withSyncDatabase(async (database) => {
    await database.stockBasic.create({
      data: {
        tsCode: '000001.SZ',
        symbol: '000001',
        name: 'Fixture',
        listStatus: 'L',
        listDate: '19910101',
        exchange: 'SZSE',
      },
    });
    const diagnostics: ImportDiagnostics = { requests: [], issues: [] };
    const result = await withImportDiagnostics(diagnostics, () =>
      prepareStockPartition(
        {
          call: async () => [
            { ts_code: '000001.SZ', trade_date: '20261030', adj_factor: 1 },
            { ts_code: '999999.SH', trade_date: '20261030', adj_factor: 1 },
          ],
        },
        { dataset: 'stock-adjustments', scope: 'all', startDate: '20261030', endDate: '20261030' },
      ),
    );
    expect(result.tables[0].records).toHaveLength(1);
    expect(result.tables[0].records[0].values.tsCode).toBe('000001.SZ');
    expect(diagnostics.issues).toContainEqual(
      expect.objectContaining({
        category: 'record',
        payload: expect.objectContaining({ ts_code: '999999.SH' }),
      }),
    );
  }));

it('filters valid records from exchanges outside the selected trading calendars without reporting them as invalid', async () =>
  withSyncDatabase(async (database) => {
    await database.stockBasic.createMany({
      data: [
        {
          tsCode: '600000.SH',
          symbol: '600000',
          name: 'SSE fixture',
          exchange: 'SSE',
          listDate: '19901219',
          listStatus: 'L',
        },
        {
          tsCode: '000004.SZ',
          symbol: '000004',
          name: 'SZSE fixture',
          exchange: 'SZSE',
          listDate: '19901201',
          listStatus: 'L',
        },
      ],
    });
    const diagnostics: ImportDiagnostics = { requests: [], issues: [] };
    const prepared = await withImportDiagnostics(diagnostics, () =>
      prepareStockPartition(
        {
          call: async () => [
            { ts_code: '600000.SH', trade_date: '20261030', open: 10, high: 11, low: 9, close: 10 },
            { ts_code: '000004.SZ', trade_date: '20261030', open: 10, high: 11, low: 9, close: 10 },
          ],
        },
        {
          dataset: 'stock-prices',
          scope: 'SSE',
          exchanges: ['SSE'],
          startDate: '20261030',
          endDate: '20261030',
        },
      ),
    );
    expect(prepared.status).toBe('complete');
    expect(prepared.tables[0].records.map((record) => record.values.tsCode)).toEqual(['600000.SH']);
    expect(prepared.checks.excludedRows).toBe(1);
    expect(diagnostics.issues).toEqual([]);
  }));
