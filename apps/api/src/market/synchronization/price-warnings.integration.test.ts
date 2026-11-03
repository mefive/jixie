import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { acceptSource } from '../../../tests/market-contract-fixtures.js';
import { withImportDiagnostics, type ImportDiagnostics } from './diagnostics.js';
import { validateSourceBar } from './source.js';
import type { MarketRow } from './partition.js';

it.each(['stock-prices', 'etf-prices'])(
  'keeps inconsistent OHLC values and the original source payload for %s',
  async (dataset) =>
    withSyncDatabase(async (database) => {
      const tsCode = dataset === 'stock-prices' ? '600000.SH' : '510300.SH';
      if (dataset === 'stock-prices') {
        await database.stockBasic.create({
          data: {
            tsCode,
            symbol: '600000',
            name: 'Fixture',
            listStatus: 'L',
            exchange: 'SSE',
            listDate: '19901219',
          },
        });
      }
      const row = {
        ts_code: tsCode,
        trade_date: '19911107',
        open: 15.5,
        high: 18.3,
        low: 17.5,
        close: 17.7,
        vol: 1044,
        amount: 9372,
      };
      const diagnostics: ImportDiagnostics = { requests: [], issues: [] };
      const result = await withImportDiagnostics(diagnostics, () =>
        acceptSource(
          database,
          { call: async () => [row] },
          { dataset, scope: tsCode, startDate: row.trade_date, endDate: row.trade_date },
        ),
      );
      expect(result.prepared.status).toBe('complete');
      expect(result.prepared.checks.invalidRows).toBe(0);
      expect(result.accepted).toMatchObject({ inserted: 1, rejected: 0, errors: [] });
      const stored =
        dataset === 'stock-prices'
          ? await database.daily.findFirst()
          : await database.etfDaily.findFirst();
      expect(stored).toMatchObject({ open: 15.5, high: 18.3, low: 17.5, close: 17.7 });
      expect(diagnostics.issues).toMatchObject([
        {
          severity: 'warning',
          reasonCode: 'ohlc_range_inconsistent',
          businessKey: { tsCode, tradeDate: row.trade_date },
          payload: row,
        },
      ]);
    }),
);

it.each<MarketRow>([
  { open: 0 },
  { close: -1 },
  { high: Number.NaN },
  { low: Number.POSITIVE_INFINITY },
  { close: null },
  { vol: -1 },
  { amount: -1 },
])('retains hard validation and emits no admitted-record warning for %j', async (invalid) => {
  const diagnostics: ImportDiagnostics = { requests: [], issues: [] };
  await withImportDiagnostics(diagnostics, async () => {
    expect(() =>
      validateSourceBar({
        tsCode: '600000.SH',
        tradeDate: '19911107',
        open: 15.5,
        high: 18.3,
        low: 17.5,
        close: 17.7,
        ...invalid,
      }),
    ).toThrow();
  });
  expect(diagnostics.issues).toEqual([]);
});

it.each([
  { open: 8, high: 12, low: 9, close: 10 },
  { open: 10, high: 12, low: 9, close: 13 },
  { open: 10, high: 9, low: 11, close: 10 },
])('warns once for an inconsistent range without mutating prices: %j', async (prices) => {
  const values = { tsCode: '600000.SH', tradeDate: '19911107', ...prices };
  const diagnostics: ImportDiagnostics = { requests: [], issues: [] };
  await withImportDiagnostics(diagnostics, async () => validateSourceBar(values));
  expect(diagnostics.issues).toHaveLength(1);
  expect(diagnostics.issues[0]).toMatchObject({
    severity: 'warning',
    reasonCode: 'ohlc_range_inconsistent',
  });
  expect(values).toEqual({ tsCode: '600000.SH', tradeDate: '19911107', ...prices });
});
