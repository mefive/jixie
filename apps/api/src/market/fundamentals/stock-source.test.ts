import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { acceptSource, seedSessions } from '../../../tests/market-contract-fixtures.js';
import { planIngestion } from '#ingestion/plan.js';
import { FINANCIAL_STATEMENT_FIELDS } from './source-contract.js';
import { resolveFinancialState } from './resolver.js';

const oldCode = '000022.SZ';
const newCode = '001872.SZ';
const period = '20260630';
const reportKinds = ['income', 'balance_sheet', 'cash_flow'] as const;
const dividendWindow = {
  dataset: 'dividends',
  scope: newCode,
  startDate: '20260101',
  endDate: '20261231',
};
const dividend = {
  ts_code: oldCode,
  end_date: period,
  ann_date: '20260701',
  ex_date: '20260715',
  div_proc: '实施',
  cash_div: 1,
  cash_div_tax: 1,
};

describe('financial stock source succession', () => {
  it.each(reportKinds)(
    'retains both %s sources and selects only historically available versions',
    async (kind) =>
      withSyncDatabase(async (database) => {
        await seedSessions(database, '20260901', '20260903');
        const fields = Object.fromEntries(
          FINANCIAL_STATEMENT_FIELDS.filter((field) => field.statementKind === kind).map(
            (field) => [field.sourceField, 100],
          ),
        );
        const old = {
          ...fields,
          ts_code: oldCode,
          end_date: period,
          ann_date: '20260831',
          f_ann_date: '20260831',
          report_type: '1',
          comp_type: '1',
          update_flag: '0',
        };
        const current = {
          ...old,
          ts_code: newCode,
          ann_date: '20260902',
          f_ann_date: '20260902',
          ...Object.fromEntries(Object.keys(fields).map((field) => [field, 200])),
        };
        const window = {
          dataset: 'financial-statements',
          scope: `${kind}|1`,
          startDate: period,
          endDate: period,
        };
        const first = await acceptSource(database, { call: async () => [current, old] }, window);
        expect(first.accepted.inserted).toBe(2);
        expect(first.accepted.errors).toEqual([]);
        const before = await resolveFinancialState(
          { tsCode: newCode, asOfDate: '20260901' },
          database,
        );
        const after = await resolveFinancialState(
          { tsCode: newCode, asOfDate: '20260903' },
          database,
        );
        const key = { income: 'income', balance_sheet: 'balanceSheet', cash_flow: 'cashFlow' }[
          kind
        ] as 'income' | 'balanceSheet' | 'cashFlow';
        expect(before.periods[0][key]).toMatchObject({ sourceTsCode: oldCode });
        expect(after.periods[0][key]).toMatchObject({ sourceTsCode: newCode });
        expect(
          after.diagnostics.some((item) => item.code === 'ambiguous_latest_statement_version'),
        ).toBe(false);
        const repeated = await acceptSource(database, { call: async () => [old, current] }, window);
        expect(repeated.accepted.changed).toBe(false);
        expect(
          first.prepared.tables[0].records.map((row) => row.values.sourceRowFingerprint).sort(),
        ).toEqual(
          repeated.prepared.tables[0].records.map((row) => row.values.sourceRowFingerprint).sort(),
        );
      }),
  );

  it.each([false, true])(
    'queries both dividend codes and preserves distinct events: reversed=%s',
    async (reversed) =>
      withSyncDatabase(async (database) => {
        const calls: unknown[] = [];
        const current = { ...dividend, ts_code: newCode, cash_div: 2, cash_div_tax: null };
        const olderEvent = { ...dividend, ann_date: '20260201', ex_date: '20260215' };
        const result = await acceptSource(
          database,
          {
            call: async (_api, params) => {
              calls.push(params?.ts_code);
              const rows =
                params?.ts_code === oldCode ? [dividend, olderEvent] : [current, dividend];
              return reversed ? [...rows].reverse() : rows;
            },
          },
          dividendWindow,
        );
        expect(calls).toEqual([newCode, oldCode]);
        expect(result.accepted.errors).toEqual([]);
        const rows = await database.dividend.findMany({ orderBy: { annDate: 'asc' } });
        expect(rows).toMatchObject([
          { cashDiv: 1, sourceTsCode: oldCode },
          { cashDiv: 2, cashDivTax: null, sourceTsCode: newCode },
        ]);

        const originalCapture = rows[1].observedAt;
        await acceptSource(
          database,
          { call: async () => [dividend, olderEvent] },
          dividendWindow,
          new Date('2026-09-20T10:00:00Z'),
        );
        expect(await database.dividend.findUnique({ where: { id: rows[1].id } })).toMatchObject({
          cashDiv: 2,
          observedAt: originalCapture,
        });
      }),
  );

  it('retains events when a predecessor request fails', async () =>
    withSyncDatabase(async (database) => {
      await acceptSource(database, { call: async () => [dividend] }, dividendWindow);
      const result = await acceptSource(
        database,
        {
          call: async (_api, params) => {
            if (params?.ts_code === oldCode) {
              throw new Error('predecessor unavailable');
            }
            return [];
          },
        },
        dividendWindow,
      );
      expect(result.prepared.status).toBe('error');
      expect(result.accepted.deleted).toBe(0);
      expect(await database.dividend.count()).toBe(1);
    }));

  it.each([false, true])(
    'uses the earliest listing bound regardless of catalog order: %s',
    async (reversed) =>
      withSyncDatabase(async (database) => {
        const rows = [
          { tsCode: oldCode, symbol: '000022', listDate: '19930505' },
          { tsCode: newCode, symbol: '001872', listDate: '20181226' },
        ].map((row) => ({ ...row, name: 'test', listStatus: 'L' }));
        await database.stockBasic.createMany({ data: reversed ? rows.reverse() : rows });
        const plan = await planIngestion('20260915', new Date('2026-09-16T10:00:00Z'));
        expect(
          plan.units.filter((unit) => unit.dataset === 'dividends').map((unit) => unit.scope),
        ).toEqual([newCode]);
      }),
  );
});
