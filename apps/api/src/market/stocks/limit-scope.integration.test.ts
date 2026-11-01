import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { prepareStockPartition } from './sync-partition.js';
import { withImportDiagnostics, type ImportDiagnostics } from '../synchronization/diagnostics.js';

it('filters non-stock limits, retains zero placeholders and records unresolved identities', async () =>
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
            {
              ts_code: '000001.SZ',
              trade_date: '20261030',
              up_limit: 0,
              down_limit: 0,
              exchange: 'SZSE',
              asset_type: 'STK',
            },
            {
              ts_code: '900901.BJ',
              trade_date: '20261030',
              up_limit: 1,
              down_limit: 1,
              exchange: null,
              asset_type: null,
            },
            {
              ts_code: '999999.SH',
              trade_date: '20261030',
              up_limit: 1,
              down_limit: 1,
              exchange: null,
              asset_type: null,
            },
          ],
        },
        { dataset: 'stock-limits', scope: 'all', startDate: '20261030', endDate: '20261030' },
      ),
    );
    expect(result.tables[0].records.map((record) => record.values)).toEqual([
      expect.objectContaining({ tsCode: '000001.SZ', upLimit: 0, downLimit: 0 }),
    ]);
    expect(result.checks.excludedRows).toBe(1);
    expect(diagnostics.issues).toContainEqual(
      expect.objectContaining({
        reasonCode: 'unrecognized_identity',
        payload: expect.objectContaining({ ts_code: '999999.SH' }),
      }),
    );
  }));
