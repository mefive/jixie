import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { prepareStockPartition } from './sync-partition.js';
import { withImportDiagnostics, type ImportDiagnostics } from '../synchronization/diagnostics.js';
import type { TushareRow } from '../providers/tushare/tushare-client.js';

const date = '20180827';
const datasets: Array<{ dataset: string; values: TushareRow }> = [
  { dataset: 'stock-prices', values: { open: 10, high: 11, low: 9, close: 10 } },
  { dataset: 'stock-adjustments', values: { adj_factor: 1 } },
  { dataset: 'stock-valuations', values: { pe: -1, pb: null } },
  { dataset: 'stock-limits', values: { up_limit: 11, down_limit: 9 } },
];

it.each(datasets)(
  'silently filters absent, malformed and missing codes before validating $dataset fields',
  async ({ dataset, values }) =>
    withSyncDatabase(async (database) => {
      await database.stockBasic.create({
        data: {
          tsCode: '600000.SH',
          symbol: '600000',
          name: 'Admitted stock',
          exchange: 'SSE',
          listStatus: 'L',
          listDate: '19901219',
        },
      });
      const diagnostics: ImportDiagnostics = { requests: [], issues: [] };
      const rows: TushareRow[] = [
        { ts_code: '600000.SH', trade_date: date, ...values },
        ...['900906.SH', '900930.SH', '900951.SH', '999999.SH', 'invalid-code', null].map(
          (ts_code) => ({ ts_code, trade_date: 'invalid-date', adj_factor: -1 }),
        ),
        { trade_date: 'invalid-date', adj_factor: -1 },
      ];
      const prepared = await withImportDiagnostics(diagnostics, () =>
        prepareStockPartition(
          { call: async () => rows },
          { dataset, scope: 'all', startDate: date, endDate: date },
        ),
      );

      expect(prepared.status).toBe('complete');
      expect(prepared.checks).toMatchObject({
        terminalPage: true,
        sourceRows: 8,
        excludedRows: 7,
        invalidRows: 0,
      });
      expect(prepared.tables[0].records.map((record) => record.values.tsCode)).toEqual([
        '600000.SH',
      ]);
      expect(prepared.errors).toEqual([]);
      expect(diagnostics.issues).toEqual([]);
    }),
);

it('trusts catalog membership rather than interpreting B-share prefixes as exclusions', async () =>
  withSyncDatabase(async (database) => {
    await database.stockBasic.create({
      data: {
        tsCode: '900906.SH',
        symbol: '900906',
        name: 'Explicitly admitted instrument',
        exchange: 'SSE',
        listStatus: 'L',
        listDate: '19920805',
      },
    });
    const prepared = await prepareStockPartition(
      { call: async () => [{ ts_code: '900906.SH', trade_date: date, adj_factor: 1 }] },
      { dataset: 'stock-adjustments', scope: 'all', startDate: date, endDate: date },
    );

    expect(prepared.status).toBe('complete');
    expect(prepared.tables[0].records.map((record) => record.values.tsCode)).toEqual(['900906.SH']);
    expect(prepared.checks.excludedRows).toBe(0);
  }));

it('accepts a complete response containing only excluded codes without a partial result', async () =>
  withSyncDatabase(async () => {
    const diagnostics: ImportDiagnostics = { requests: [], issues: [] };
    const prepared = await withImportDiagnostics(diagnostics, () =>
      prepareStockPartition(
        { call: async () => [{ ts_code: '900906.SH', trade_date: date, adj_factor: 1 }] },
        { dataset: 'stock-adjustments', scope: 'all', startDate: date, endDate: date },
      ),
    );

    expect(prepared.status).toBe('complete');
    expect(prepared.tables[0].records).toEqual([]);
    expect(prepared.checks).toMatchObject({ sourceRows: 1, excludedRows: 1, invalidRows: 0 });
    expect(diagnostics.issues).toEqual([]);
  }));
