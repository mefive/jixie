import { describe, expect, it, vi } from 'vitest';
import { RESEARCH_FINANCIAL_FIELDS_V1 } from '@jixie/shared';

import { FINANCIAL_STATEMENT_FIELDS } from '../../market/fundamentals/source-contract.js';
import { loadResearchFinancialValues } from './financial-values.js';
import { loadResearchFinancialMetrics, loadResearchFinancialStatements } from './financial.js';
import {
  parseResearchFinancialValuesRuntimeRequest,
  parseResearchFinancialValuesRuntimeRows,
  parseResearchFinancialStatementsRuntimeRequest,
} from '../sdk/validation.js';

const request = {
  identifiers: ['000858.SZ', '600519.SH'],
  as_of: '20240831',
  fields: ['income.revenue'],
  report_start: '20240630',
  report_end: '20240630',
};
const history = [
  ['20230331', 40],
  ['20230630', 100],
  ['20230930', 190],
  ['20231231', 340],
  ['20240331', 50],
  ['20240630', 120],
] as const;

function row(date: string, value: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `income-${date}`,
    source: 'tushare',
    contractVersion: 1,
    tsCode: '000858.SZ',
    annDate: date,
    fAnnDate: date,
    endDate: date,
    reportType: '1',
    compType: '1',
    updateFlag: '0',
    sourceRowFingerprint: `income-${date}`,
    announcementDate: date,
    availableDate: date,
    availabilityQuality: 'conservative',
    revenue: value,
    ...overrides,
  };
}
function database(
  income = history.map(([date, value]) => row(date, value)),
  balances: ReturnType<typeof row>[] = [],
  cash: ReturnType<typeof row>[] = [],
  bank = false,
) {
  const table = (rows: ReturnType<typeof row>[]) => ({
    findMany: vi.fn(async ({ where }) =>
      rows.filter(
        (entry) =>
          (typeof where.tsCode === 'string'
            ? where.tsCode === entry.tsCode
            : where.tsCode.in.includes(entry.tsCode)) &&
          entry.availableDate <= where.availableDate.lte &&
          entry.compType === where.compType &&
          (!where.endDate?.gte || entry.endDate >= where.endDate.gte) &&
          (!where.endDate?.lte || entry.endDate <= where.endDate.lte),
      ),
    ),
  });
  const industry = { l1Code: bank ? '801780.SI' : '801120.SI', l1Name: bank ? '银行' : '食品饮料' };
  return {
    financialIncomeStatement: table(income),
    financialBalanceSheet: table(balances),
    financialCashFlowStatement: table(cash),
    swIndustryMember: {
      findMany: vi.fn(async () => [{ tsCode: '000858.SZ', ...industry }]),
      findFirst: vi.fn(async () => industry),
    },
    dailyBasic: { findFirst: vi.fn(async () => null) },
    stockNameHistory: { findFirst: vi.fn(async () => ({ name: 'Fixture' })) },
  };
}

describe('selected financial values', () => {
  it('keeps the explicit public mapping consistent with source units and stock/flow semantics', () => {
    const camel = (value: string) =>
      value.replace(/_([a-z0-9])/g, (_match, character: string) => character.toUpperCase());
    expect(RESEARCH_FINANCIAL_FIELDS_V1).toHaveLength(FINANCIAL_STATEMENT_FIELDS.length);
    for (const field of RESEARCH_FINANCIAL_FIELDS_V1) {
      const original = FINANCIAL_STATEMENT_FIELDS.find(
        (source) =>
          source.statementKind === field.statementKind && camel(source.sourceField) === field.field,
      );
      expect(original, field.key).toMatchObject({
        unit: field.unit,
        periodSemantics: field.semantics,
      });
    }
  });

  it('loads prerequisite periods in four queries and preserves missing companies', async () => {
    const db = database();
    const rows = await loadResearchFinancialValues({ ...request, period: 'ttm' }, db as never);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      value: 360,
      period_basis: 'ttm',
      status: 'ok',
      available_date: '20240630',
    });
    expect(JSON.parse(rows[0].input_versions_json)).toContain('income-20230630');
    expect(rows[1]).toMatchObject({
      code: '600519.SH',
      value: null,
      missing_reason: 'no_statement_available_as_of',
    });
    for (const delegate of [
      db.financialIncomeStatement,
      db.financialBalanceSheet,
      db.financialCashFlowStatement,
      db.swIndustryMember,
    ]) {
      expect(delegate.findMany).toHaveBeenCalledTimes(1);
    }
    expect(parseResearchFinancialValuesRuntimeRows(rows)).toEqual(rows);
  });

  it('separates reported, quarterly, annual, and stock observations', async () => {
    const db = database(
      undefined,
      [row('20240630', 0, { totalAssets: 900, totalShare: 20 })],
      [row('20240630', 0, { cCashEquBegPeriod: 80, cCashEquEndPeriod: 120 })],
    );
    const single = { ...request, identifiers: '000858.SZ' };
    expect((await loadResearchFinancialValues(single, db as never))[0].value).toBe(120);
    const quarterly = await loadResearchFinancialValues(
      {
        ...single,
        period: 'quarterly',
        fields: [
          'income.revenue',
          'balance_sheet.totalAssets',
          'balance_sheet.totalShare',
          'cash_flow.cCashEquBegPeriod',
        ],
      },
      db as never,
    );
    expect(quarterly.map((entry) => [entry.value, entry.period_basis, entry.unit])).toEqual([
      [70, 'quarterly', 'CNY'],
      [900, 'point_in_time', 'CNY'],
      [20, 'point_in_time', 'shares'],
      [80, 'point_in_time', 'CNY'],
    ]);
    const annual = await loadResearchFinancialValues(
      { ...single, period: 'annual', report_start: '20230101' },
      db as never,
    );
    expect(annual).toHaveLength(1);
    expect(annual[0]).toMatchObject({
      report_period: '20231231',
      value: 340,
      period_basis: 'annual',
    });
  });

  it('never fills missing quarters or borrows a later correction', async () => {
    const sources = history.map(([date, value]) => row(date, value));
    const original = await loadResearchFinancialValues(
      { ...request, period: 'ttm' },
      database([
        ...sources,
        row('20240630', 130, { sourceRowFingerprint: 'future', availableDate: '20240902' }),
        row('20240630', 140, {
          sourceRowFingerprint: 'reconstructed',
          availableDate: '20240801',
          availabilityQuality: 'reconstructed',
        }),
      ]) as never,
    );
    expect(original[0].value).toBe(360);
    const revised = await loadResearchFinancialValues(
      { ...request, as_of: '20240902', period: 'ttm' },
      database([
        ...sources,
        row('20240630', 130, {
          sourceRowFingerprint: 'correction',
          availableDate: '20240902',
          availabilityQuality: 'exact',
        }),
      ]) as never,
    );
    expect(revised[0]).toMatchObject({ value: 370, available_date: '20240902' });
    const missing = await loadResearchFinancialValues(
      { ...request, period: 'ttm' },
      database(sources.filter((entry) => entry.endDate !== '20230930')) as never,
    );
    expect(missing[0]).toMatchObject({ value: null, status: 'missing' });
    expect(missing[0].missing_reason).toBeTruthy();
  });

  it('reports ambiguous versions and keeps invalid raw accounting values visible', async () => {
    const ambiguous = await loadResearchFinancialValues(
      request,
      database([
        row('20240630', 10),
        row('20240630', 20, { sourceRowFingerprint: 'other' }),
      ]) as never,
    );
    expect(ambiguous[0]).toMatchObject({
      value: null,
      missing_reason: 'ambiguous_latest_statement_version',
    });
    const negative = await loadResearchFinancialValues(
      { ...request, fields: ['cash_flow.cPayAcqConstFiolta'] },
      database([], [], [row('20240630', 0, { cPayAcqConstFiolta: -10 })]) as never,
    );
    expect(negative[0]).toMatchObject({ value: -10, status: 'ok' });
    const nonstandard = await loadResearchFinancialValues(
      {
        ...request,
        identifiers: '000858.SZ',
        period: 'quarterly',
        report_start: '20240629',
        report_end: '20240629',
      },
      database([row('20240629', 120)]) as never,
    );
    expect(nonstandard[0]).toMatchObject({
      value: null,
      missing_reason: 'non_standard_report_period',
      input_versions_json: '["income-20240629"]',
    });
  });

  it('separates unintegrated sector data from model applicability', async () => {
    const emptyBank = database([], [], [], true);
    expect(
      await loadResearchFinancialStatements(
        { identifier: '000858.SZ', as_of: request.as_of },
        emptyBank as never,
      ),
    ).toEqual([]);
    expect((await loadResearchFinancialValues(request, emptyBank as never))[0]).toMatchObject({
      missing_reason: 'financial_sector_source_not_integrated',
    });
    const mapped = database([row('20240630', 120)], [], [], true);
    expect(
      (
        await loadResearchFinancialStatements(
          { identifier: '000858.SZ', as_of: request.as_of, fields: 'income.revenue' },
          mapped as never,
        )
      )[0].value,
    ).toBe(120);
    expect(
      (
        await loadResearchFinancialMetrics(
          { identifier: '000858.SZ', as_of: request.as_of },
          mapped as never,
        )
      )[0].status,
    ).toBe('not_applicable');
  });

  it('filters original statements without changing unfiltered calls', async () => {
    const db = database();
    const original = { identifier: '000858.SZ', as_of: request.as_of };
    expect(parseResearchFinancialStatementsRuntimeRequest(original)).toEqual(original);
    const filtered = await loadResearchFinancialStatements(
      { ...original, fields: 'income.revenue', report_start: '20240101', report_end: '20240630' },
      db as never,
    );
    expect(filtered.map((entry) => [entry.report_period, entry.value])).toEqual([
      ['20240331', 50],
      ['20240630', 120],
    ]);
    await expect(
      loadResearchFinancialStatements({ ...original, fields: 'totalRevenue' }, db as never),
    ).rejects.toThrow('mapped financial fields');
  });

  it('validates request budgets, calendar dates, and qualified fields before loading', async () => {
    const db = database();
    for (const invalid of [
      { ...request, identifiers: Array.from({ length: 101 }, () => '000858.SZ') },
      { ...request, identifiers: ['000858.SZ', '000858.SZ'] },
      { ...request, as_of: '20240230' },
      { ...request, report_start: '20240230' },
      { ...request, report_start: '20250101' },
      { ...request, report_start: '20000101' },
      { ...request, fields: [] },
      { ...request, fields: ['revenue'] },
    ]) {
      await expect(loadResearchFinancialValues(invalid, db as never)).rejects.toThrow();
    }
    expect(db.financialIncomeStatement.findMany).not.toHaveBeenCalled();
    expect(parseResearchFinancialValuesRuntimeRequest(request)).toMatchObject({
      period: 'reported',
    });
    expect(() =>
      parseResearchFinancialValuesRuntimeRequest({ ...request, fields: ['totalAssets'] }),
    ).toThrow();
  });
});
