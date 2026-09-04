import { describe, expect, it, vi } from 'vitest';

import {
  resolveFinancialState,
  selectLatestStatementVersions,
  type FinancialDiagnostic,
  type ResolvedIncomeStatement,
} from './resolver.js';

describe('financial statement resolver', () => {
  it('uses the latest strict-PIT version and keeps a later reconstructed change excluded', () => {
    const diagnostics: FinancialDiagnostic[] = [];
    const selected = selectLatestStatementVersions(
      [
        incomeVersion({
          availableDate: '20230430',
          sourceRowFingerprint: 'original',
          values: { revenue: 100 },
        }),
        incomeVersion({
          availableDate: '20240104',
          availabilityQuality: 'exact',
          sourceRowFingerprint: 'official-correction',
          values: { revenue: 90 },
        }),
        incomeVersion({
          availableDate: '20240201',
          availabilityQuality: 'reconstructed',
          sourceRowFingerprint: 'provider-backfill',
          values: { revenue: 95 },
        }),
      ],
      diagnostics,
    );

    expect(selected).toEqual([
      expect.objectContaining({ sourceRowFingerprint: 'official-correction' }),
    ]);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'reconstructed_versions_excluded' }),
      ]),
    );
  });

  it('prefers an adjusted statement and collapses identical same-rank provider rows', () => {
    const diagnostics: FinancialDiagnostic[] = [];
    const selected = selectLatestStatementVersions(
      [
        incomeVersion({ reportType: '5', sourceRowFingerprint: 'pre', values: { revenue: 80 } }),
        incomeVersion({ reportType: '4', sourceRowFingerprint: 'adjusted-b' }),
        incomeVersion({ reportType: '4', sourceRowFingerprint: 'adjusted-a' }),
      ],
      diagnostics,
    );

    expect(selected[0]).toMatchObject({ reportType: '4', sourceRowFingerprint: 'adjusted-a' });
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'equivalent_statement_versions_collapsed' }),
      ]),
    );
  });

  it('does not guess between equally ranked versions with different typed values', () => {
    const diagnostics: FinancialDiagnostic[] = [];
    const selected = selectLatestStatementVersions(
      [
        incomeVersion({ sourceRowFingerprint: 'left', values: { revenue: 100 } }),
        incomeVersion({ sourceRowFingerprint: 'right', values: { revenue: 101 } }),
      ],
      diagnostics,
    );

    expect(selected).toEqual([]);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ambiguous_latest_statement_version' }),
      ]),
    );
  });

  it('gates the first statement on availableDate and converts market cap to CNY', async () => {
    const row = databaseStatement({ availableDate: '20230504' });
    const database = resolverDatabase({ income: [row], marketCapitalizationWan: 20 });

    const before = await resolveFinancialState(
      { tsCode: '000858.SZ', asOfDate: '20230503' },
      database as never,
    );
    const after = await resolveFinancialState(
      { tsCode: '000858.SZ', asOfDate: '20230504' },
      database as never,
    );

    expect(before.periods).toEqual([]);
    expect(after.periods).toHaveLength(1);
    expect(after.periods[0].income?.sourceRowFingerprint).toBe('fingerprint');
    expect(after.market).toMatchObject({ marketCapitalization: 200_000 });
    expect(database.financialIncomeStatement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ availableDate: { lte: '20230503' } }),
      }),
    );
  });

  it('keeps the old version until the correction becomes available', async () => {
    const database = resolverDatabase({
      income: [
        databaseStatement({ sourceRowFingerprint: 'old', availableDate: '20231030' }),
        databaseStatement({
          sourceRowFingerprint: 'corrected',
          availableDate: '20240104',
          availabilityQuality: 'exact',
          revenue: 90,
        }),
      ],
    });

    const before = await resolveFinancialState(
      { tsCode: '000858.SZ', asOfDate: '20240103' },
      database as never,
    );
    const after = await resolveFinancialState(
      { tsCode: '000858.SZ', asOfDate: '20240104' },
      database as never,
    );

    expect(before.periods[0].income?.sourceRowFingerprint).toBe('old');
    expect(after.periods[0].income?.sourceRowFingerprint).toBe('corrected');
  });

  it('rejects the industrial-company kernel for a PIT financial-industry member', async () => {
    const database = resolverDatabase({
      income: [databaseStatement({})],
      industry: { l1Code: '801780.SI', l1Name: '银行' },
    });

    const state = await resolveFinancialState(
      { tsCode: '000001.SZ', asOfDate: '20240501' },
      database as never,
    );

    expect(state.applicability).toBe('unsupported_financial');
    expect(state.periods).toEqual([]);
    expect(state.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unsupported_financial_company' })]),
    );
  });
});

function incomeVersion(
  overrides: Omit<Partial<ResolvedIncomeStatement>, 'values'> & {
    values?: Partial<ResolvedIncomeStatement['values']>;
  },
): ResolvedIncomeStatement {
  return {
    id: 'id',
    source: 'tushare',
    contractVersion: 1,
    statementKind: 'income',
    tsCode: '000858.SZ',
    endDate: '20221231',
    announcementDate: '20230429',
    availableDate: '20230430',
    availabilityQuality: 'conservative',
    reportType: '1',
    compType: '1',
    updateFlag: '0',
    sourceRowFingerprint: 'fingerprint',
    ...overrides,
    values: {
      totalRevenue: null,
      revenue: 100,
      operCost: 60,
      operateProfit: 20,
      totalProfit: 20,
      incomeTax: 5,
      nIncome: 15,
      nIncomeAttrP: 15,
      ebit: null,
      rdExp: null,
      finExpIntExp: null,
      ...overrides.values,
    },
  };
}

function databaseStatement(overrides: Record<string, unknown>) {
  return {
    id: 'id',
    source: 'tushare',
    contractVersion: 1,
    tsCode: '000858.SZ',
    annDate: '20230429',
    fAnnDate: '20230429',
    endDate: '20221231',
    reportType: '1',
    compType: '1',
    updateFlag: '0',
    observedAt: new Date('2023-05-01T00:00:00Z'),
    sourceRowFingerprint: 'fingerprint',
    announcementDate: '20230429',
    availableDate: '20230504',
    availabilityQuality: 'conservative',
    evidenceSource: 'tushare_statement',
    evidenceId: null,
    revenue: 100,
    ...overrides,
  };
}

function resolverDatabase(options: {
  income?: Array<Record<string, unknown>>;
  industry?: { l1Code: string; l1Name: string } | null;
  marketCapitalizationWan?: number | null;
}) {
  const delegate = (rows: Array<Record<string, unknown>>) => ({
    findMany: vi.fn(async (args) =>
      rows.filter((row) => String(row.availableDate) <= args.where.availableDate.lte),
    ),
  });
  return {
    financialIncomeStatement: delegate(options.income ?? []),
    financialBalanceSheet: delegate([]),
    financialCashFlowStatement: delegate([]),
    swIndustryMember: {
      findFirst: vi.fn().mockResolvedValue(options.industry ?? null),
    },
    dailyBasic: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          options.marketCapitalizationWan === undefined
            ? null
            : { tradeDate: '20230504', totalMv: options.marketCapitalizationWan },
        ),
    },
  };
}
