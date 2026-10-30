import { describe, expect, it } from 'vitest';
import { withSyncDatabase } from '../../../tests/sync-database.js';
import { acceptSource, seedSessions } from '../../../tests/market-contract-fixtures.js';
import type { TushareRow } from '../providers/tushare/tushare-client.js';
import { FINANCIAL_STATEMENT_FIELDS } from './source-contract.js';

const period = '20260630';

describe('statement maintenance through the formal entry', () => {
  it.each(['income', 'balance_sheet', 'cash_flow'])(
    'accepts documented company types but stores only industrial reports: %s',
    async (kind) =>
      withSyncDatabase(async (database) => {
        await seedSessions(database, '20260901');
        const fields = Object.fromEntries(
          FINANCIAL_STATEMENT_FIELDS.filter((field) => field.statementKind === kind).map(
            (field) => [field.sourceField, null],
          ),
        );
        const rows = ['1', '2', '3', '4', '7'].map((companyType) => ({
          ts_code: `60000${companyType}.SH`,
          ann_date: '20260831',
          f_ann_date: '20260831',
          end_date: period,
          report_type: '1',
          comp_type: companyType,
          update_flag: '0',
          ...fields,
        }));

        const result = await acceptSource(
          database,
          { call: async () => rows },
          {
            dataset: 'financial-statements',
            scope: `${kind}|1`,
            startDate: period,
            endDate: period,
          },
        );

        expect(result.prepared.status).toBe('complete');
        expect(result.prepared.errors).toEqual([]);
        expect(result.prepared.tables[0].records).toHaveLength(1);
        expect(result.prepared.tables[0].records[0].values.compType).toBe('1');
        expect(result.accepted.inserted).toBe(1);
      }),
  );

  it.each(['9', null, undefined])('rejects unknown or missing company types: %s', async (type) =>
    withSyncDatabase(async (database) => {
      const row: TushareRow = { ts_code: '600000.SH', end_date: period, report_type: '1' };
      if (type !== undefined) {
        row.comp_type = type;
      }

      const result = await acceptSource(
        database,
        { call: async () => [row] },
        { dataset: 'financial-statements', scope: 'income|1', startDate: period, endDate: period },
      );

      expect(result.prepared.status).toBe('error');
      expect(result.prepared.errors).toContain(
        'Invalid financial report period/type/company classification',
      );
      expect(result.accepted.inserted).toBe(0);
    }),
  );

  it('maps every declared field including numeric suffixes and appends all three report types idempotently', async () =>
    withSyncDatabase(async (database) => {
      await seedSessions(database, '20260901');
      for (const kind of ['income', 'balance_sheet', 'cash_flow']) {
        for (const reportType of ['1', '4', '5']) {
          const fields = Object.fromEntries(
            FINANCIAL_STATEMENT_FIELDS.filter((field) => field.statementKind === kind).map(
              (field) => [
                field.sourceField,
                field.sourceField === 'non_cur_liab_due_1y' ? 123 : null,
              ],
            ),
          );
          const row = {
            ts_code: '600000.SH',
            ann_date: '20260831',
            f_ann_date: '20260831',
            end_date: period,
            report_type: reportType,
            comp_type: '1',
            update_flag: '0',
            ...fields,
          };
          const partition = {
            dataset: 'financial-statements',
            scope: `${kind}|${reportType}`,
            startDate: period,
            endDate: period,
          };
          const first = await acceptSource(database, { call: async () => [row, row] }, partition);
          expect(first.prepared.errors).toEqual([]);
          expect(first.accepted.rejected).toBe(0);
          expect(first.accepted.inserted).toBe(1);
          const repeated = await acceptSource(database, { call: async () => [row] }, partition);
          expect(repeated.accepted.changed).toBe(false);
        }
      }
      expect(await database.financialBalanceSheet.findFirst()).toMatchObject({
        nonCurLiabDue1y: 123,
      });
      expect(await database.financialIncomeStatement.count()).toBe(3);
      expect(await database.financialCashFlowStatement.count()).toBe(3);
    }));

  it('records an empty optional adjustment response as a successful check without inventing a report', async () =>
    withSyncDatabase(async (database) => {
      const result = await acceptSource(
        database,
        { call: async () => [] },
        { dataset: 'financial-statements', scope: 'income|4', startDate: period, endDate: period },
      );
      expect(result.prepared.status).toBe('complete');
      expect(result.prepared.observedDates).toEqual([]);
      expect(await database.financialIncomeStatement.count()).toBe(0);
    }));
});
