import { RESEARCH_FINANCIAL_METRICS_V1 } from '@jixie/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  FINANCIAL_FORMULA_VERSION,
  FINANCIAL_METRIC_DEFINITIONS,
} from '../fundamentals/metrics.js';
import {
  loadResearchFinancialMetrics,
  loadResearchFinancialStatements,
} from './financial-dataset.js';

describe('research financial datasets', () => {
  it('keeps the public metric contract synchronized with the calculation kernel', () => {
    expect(Object.keys(FINANCIAL_METRIC_DEFINITIONS)).toEqual([...RESEARCH_FINANCIAL_METRICS_V1]);
  });

  it('returns the old statement until the exact correction becomes available', async () => {
    const database = financialDatabase({
      income: [
        incomeRow({
          availableDate: '20230430',
          sourceRowFingerprint: 'original',
          revenue: 100,
        }),
        incomeRow({
          availableDate: '20240104',
          sourceRowFingerprint: 'official-correction',
          availabilityQuality: 'exact',
          revenue: 90,
        }),
        incomeRow({
          availableDate: '20240101',
          sourceRowFingerprint: 'provider-backfill',
          availabilityQuality: 'reconstructed',
          revenue: 95,
        }),
      ],
    });

    const before = await loadResearchFinancialStatements(
      { identifier: '000858.SZ', as_of: '20240103' },
      database as never,
    );
    const after = await loadResearchFinancialStatements(
      { identifier: '000858.SZ', as_of: '20240104' },
      database as never,
    );

    expect(before.find((row) => row.field === 'revenue')).toMatchObject({
      value: 100,
      source_row_fingerprint: 'original',
      unit: 'CNY',
    });
    expect(after.find((row) => row.field === 'revenue')).toMatchObject({
      value: 90,
      source_row_fingerprint: 'official-correction',
      availability_quality: 'exact',
    });
  });

  it('returns auditable long-form metrics and explicit financial-industry exclusions', async () => {
    const industrial = await loadResearchFinancialMetrics(
      { identifier: '000858.SZ', as_of: '20240501' },
      financialDatabase({ income: [incomeRow({ revenue: 100 })] }) as never,
    );
    const revenue = industrial.find((row) => row.metric === 'revenue');

    expect(industrial).toHaveLength(RESEARCH_FINANCIAL_METRICS_V1.length);
    expect(revenue).toMatchObject({
      date: '20240501',
      code: '000858.SZ',
      name: '五粮液',
      report_period: '20221231',
      value: 100,
      unit: 'CNY',
      status: 'ok',
      formula_version: FINANCIAL_FORMULA_VERSION,
    });
    expect(JSON.parse(revenue!.input_versions_json)).toEqual(['income-version']);

    const bank = await loadResearchFinancialMetrics(
      { identifier: '000001.SZ', as_of: '20240501' },
      financialDatabase({
        code: '000001.SZ',
        name: '平安银行',
        industry: { l1Code: '801780.SI', l1Name: '银行' },
      }) as never,
    );

    expect(bank).toHaveLength(RESEARCH_FINANCIAL_METRICS_V1.length);
    expect(bank.every((row) => row.status === 'not_applicable')).toBe(true);
    expect(bank[0]).toMatchObject({
      report_period: null,
      missing_reason: 'unsupported_financial_company',
    });
  });
});

function financialDatabase(options: {
  code?: string;
  name?: string;
  income?: Array<Record<string, unknown>>;
  industry?: { l1Code: string; l1Name: string } | null;
}) {
  const code = options.code ?? '000858.SZ';
  const delegate = (rows: Array<Record<string, unknown>>) => ({
    findMany: vi.fn(async (args) =>
      rows.filter(
        (row) => row.tsCode === code && String(row.availableDate) <= args.where.availableDate.lte,
      ),
    ),
  });
  return {
    financialIncomeStatement: delegate(options.income ?? []),
    financialBalanceSheet: delegate([]),
    financialCashFlowStatement: delegate([]),
    swIndustryMember: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          options.industry === undefined
            ? { l1Code: '801120.SI', l1Name: '食品饮料' }
            : options.industry,
        ),
    },
    dailyBasic: { findFirst: vi.fn().mockResolvedValue(null) },
    stockNameHistory: {
      findFirst: vi.fn().mockResolvedValue({ name: options.name ?? '五粮液' }),
    },
  };
}

function incomeRow(overrides: Record<string, unknown>) {
  return {
    id: 'income-id',
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
    sourceRowFingerprint: 'income-version',
    announcementDate: '20230429',
    availableDate: '20230430',
    availabilityQuality: 'conservative',
    evidenceSource: 'tushare_statement',
    evidenceId: null,
    totalRevenue: 100,
    revenue: 100,
    operCost: 60,
    operateProfit: 20,
    totalProfit: 20,
    incomeTax: 5,
    nIncome: 15,
    nIncomeAttrP: 15,
    ebit: null,
    rdExp: null,
    finExpIntExp: 0,
    ...overrides,
  };
}
