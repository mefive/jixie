import { expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { loadMarketDiagnosticContext, DIAGNOSTIC_CONTEXT_LIMIT } from './diagnostic-context.js';

it(
  'retains schema and precise limitations for failed requests, malformed dates and unknown datasets',
  async () =>
    withSyncDatabase(async (database) => {
      const request = {
        dataset: 'stock-prices',
        scope: 'SSE,SZSE',
        period: '19911107',
        startDate: '19911107',
        endDate: '19911107',
        payload: null,
        businessKey: null,
      };
      const missing = await loadMarketDiagnosticContext(database, request);
      expect(missing).toMatchObject({
        contextComplete: false,
        tableNames: expect.arrayContaining(['Daily']),
        tables: [],
      });
      expect(missing.limitations).toContain('missing_security_or_trade_date');
      const malformed = await loadMarketDiagnosticContext(database, {
        ...request,
        payload: { ts_code: '000003.SZ', trade_date: 'bad' },
      });
      expect(malformed.contextComplete).toBe(false);
      expect(malformed.limitations).toContain('invalid_source_trade_date');
      for (const dataset of ['unknown', '__proto__', 'toString']) {
        const unknown = await loadMarketDiagnosticContext(database, { ...request, dataset });
        expect(unknown).toMatchObject({ contextComplete: false, tables: [] });
        expect(unknown.limitations).toContain('unsupported_dataset');
      }
    }),
  60_000,
);

it(
  'exports an atomic constituent snapshot and leaves missing source ranking evidence explicit',
  async () =>
    withSyncDatabase(async (database) => {
      await database.indexWeight.createMany({
        data: [
          { indexCode: '000300.SH', conCode: '600000.SH', tradeDate: '20181228', weight: 5 },
          { indexCode: '000300.SH', conCode: '600001.SH', tradeDate: '20181228', weight: 6 },
        ],
      });
      const context = await loadMarketDiagnosticContext(database, {
        dataset: 'index-weights',
        scope: '000300.SH',
        period: '201812',
        startDate: '20181201',
        endDate: '20181231',
        businessKey: null,
        payload: { index_code: '000300.SH', con_code: '600000.SH', trade_date: '20181228' },
      });
      expect(context).toMatchObject({
        contextComplete: true,
        ruleCodes: expect.arrayContaining(['constituent_snapshot_is_atomic']),
      });
      expect(context.tables[0]).toMatchObject({
        table: 'IndexWeight',
        matchedCount: 2,
        returnedCount: 2,
        complete: true,
      });
      const selection = await loadMarketDiagnosticContext(database, {
        dataset: 'etf-selection',
        scope: 'SSE,SZSE',
        period: '20181228',
        payload: null,
        businessKey: null,
      });
      expect(selection.contextComplete).toBe(false);
      expect(selection.limitations).toContain('historical_ranking_response_not_persisted');
    }),
  60_000,
);

it(
  'bounds related business rows without silently claiming a truncated context is complete',
  async () =>
    withSyncDatabase(async (database) => {
      await database.dividend.createMany({
        data: Array.from({ length: DIAGNOSTIC_CONTEXT_LIMIT + 1 }, (_, index) => ({
          id: `distribution-${String(index).padStart(5, '0')}`,
          tsCode: '300587.SZ',
          endDate: '20181231',
          cashDivTax: 0.15,
        })),
      });
      const context = await loadMarketDiagnosticContext(database, {
        dataset: 'dividends',
        scope: '300587.SZ',
        period: 'all',
        startDate: '',
        endDate: '20181231',
        businessKey: null,
        payload: { ts_code: '300587.SZ', end_date: '20181231' },
      });
      expect(context.contextComplete).toBe(false);
      expect(context.limitations).toContain('business_context_row_limit_exceeded');
      expect(context.tables[0]).toMatchObject({
        table: 'Dividend',
        complete: false,
        match: 'incomplete',
        matchedCount: null,
        matchedCountAtLeast: 5001,
        returnedCount: 5000,
      });
      expect(context.tables[0].rows).toHaveLength(5000);
      expect(await database.dividend.count()).toBe(5001);
    }),
  60_000,
);

it(
  'exports catalog, names, ETF, indicator and statement context through their explicit readers',
  async () =>
    withSyncDatabase(async (database) => {
      const payload = { ts_code: '600000.SH', trade_date: '20181228', end_date: '20181231' };
      const request = {
        scope: '600000.SH',
        period: 'all',
        payload,
        businessKey: null,
        startDate: '20181201',
        endDate: '20181231',
      };
      const datasets = [
        ['stock-master', '600000.SH', 'StockBasic'],
        ['stock-names', '600000.SH', 'StockNameHistory'],
        ['etf-master', '510000.SH', 'EtfBasic'],
        ['etf-prices', '510000.SH', 'EtfDaily'],
        ['etf-adjustments', '510000.SH', 'EtfAdjFactor'],
        ['index-prices', '000300.SH', 'IndexDaily'],
        ['index-valuations', '000300.SH', 'IndexDailyBasic'],
        ['financial-indicators', 'all', 'FinaIndicatorVersion'],
        ['financial-statements', 'income|1', 'FinancialIncomeStatement'],
        ['financial-statements', 'balance_sheet|4', 'FinancialBalanceSheet'],
        ['financial-statements', 'cash_flow|5', 'FinancialCashFlowStatement'],
      ];
      for (const [dataset, scope, table] of datasets) {
        const scopedPayload = [
          'etf-master',
          'etf-prices',
          'etf-adjustments',
          'index-prices',
          'index-valuations',
        ].includes(dataset)
          ? { ...payload, ts_code: scope }
          : payload;
        const context = await loadMarketDiagnosticContext(database, {
          ...request,
          dataset,
          scope,
          payload: scopedPayload,
        });
        expect(context.tableNames).toContain(table);
        expect(context.tables.find((item) => item.table === table)).toMatchObject({
          match: 'not_found',
          matchedCount: 0,
        });
      }
      await database.tradeCal.create({
        data: { exchange: 'SZSE', calDate: '20181228', isOpen: 1 },
      });
      const calendar = await loadMarketDiagnosticContext(database, {
        ...request,
        dataset: 'calendar',
        scope: 'SZSE',
      });
      expect(calendar.tables[0]).toMatchObject({
        table: 'TradeCal',
        matchedCount: 1,
        rows: [expect.objectContaining({ exchange: 'SZSE' })],
      });
    }),
  60_000,
);
