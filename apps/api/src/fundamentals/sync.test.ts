import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TushareClient } from '../tushare/client.js';
import type { FinancialCorrectionEvidence } from './source-contract.js';

const mocks = vi.hoisted(() => ({
  income: vi.fn(),
  balanceSheet: vi.fn(),
  cashFlowStatement: vi.fn(),
  incomeVip: vi.fn(),
  balanceVip: vi.fn(),
  cashVip: vi.fn(),
}));

vi.mock('../tushare/api.js', () => ({
  incomeStatement: mocks.income,
  balanceSheet: mocks.balanceSheet,
  cashFlowStatement: mocks.cashFlowStatement,
  incomeStatementVip: mocks.incomeVip,
  balanceSheetVip: mocks.balanceVip,
  cashFlowStatementVip: mocks.cashVip,
}));

const {
  financialStatementDateWindows,
  storeFinancialCorrectionEvidence,
  syncFinancialStatementsByStock,
  syncFinancialStatementsVip,
} = await import('./sync.js');

const client = {} as TushareClient;

describe('financial statement synchronization', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset().mockResolvedValue([]);
    }
  });

  it('appends all explicit report types once and keeps a repeated VIP sync idempotent', async () => {
    mocks.incomeVip.mockImplementation(async (_client, _period, reportType) => [
      statementRow(reportType, { revenue: 100 }),
    ]);
    mocks.balanceVip.mockImplementation(async (_client, _period, reportType) => [
      statementRow(reportType, { total_assets: 200 }),
    ]);
    mocks.cashVip.mockImplementation(async (_client, _period, reportType) => [
      statementRow(reportType, { n_cashflow_act: 30 }),
    ]);
    const database = createDatabase(['20230504']);

    const first = await syncFinancialStatementsVip(client, ['20221231'], {}, database as never);
    const repeated = await syncFinancialStatementsVip(client, ['20221231'], {}, database as never);

    expect(first).toMatchObject({ processed: 1, changed: 1, created: 9, updated: 0 });
    expect(repeated).toMatchObject({ processed: 1, changed: 0, created: 0, updated: 0 });
    expect(mocks.incomeVip.mock.calls.map((call) => call[2])).toEqual([
      '1',
      '4',
      '5',
      '1',
      '4',
      '5',
    ]);
    expect(database.income.rows).toHaveLength(3);
    expect(database.income.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          availableDate: '20230504',
          availabilityQuality: 'conservative',
          reportType: '1',
        }),
        expect.objectContaining({ reportType: '4' }),
        expect.objectContaining({ reportType: '5' }),
      ]),
    );
  });

  it('marks only the changed same-date provider version as reconstructed', async () => {
    mocks.incomeVip.mockImplementation(async (_client, _period, reportType) =>
      reportType === '1'
        ? [
            statementRow('1', { update_flag: '0', ebit: null }),
            statementRow('1', { update_flag: '1', ebit: 90 }),
          ]
        : [],
    );
    const database = createDatabase(['20230504']);

    await syncFinancialStatementsVip(client, ['20221231'], {}, database as never);

    expect(database.income.rows.map((row) => row.availabilityQuality)).toEqual([
      'conservative',
      'reconstructed',
    ]);
  });

  it('repairs standard APIs through bounded calendar-year windows', async () => {
    const database = createDatabase([]);

    const summary = await syncFinancialStatementsByStock(
      client,
      ['000858.SZ'],
      { startDate: '20221201', endDate: '20240115' },
      database as never,
    );

    expect(financialStatementDateWindows('20221201', '20240115')).toEqual([
      { startDate: '20221201', endDate: '20221231' },
      { startDate: '20230101', endDate: '20231231' },
      { startDate: '20240101', endDate: '20240115' },
    ]);
    expect(summary).toMatchObject({ processed: 1, created: 0 });
    expect(mocks.income).toHaveBeenCalledTimes(9);
    expect(mocks.income).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        ts_code: '000858.SZ',
        start_date: '20230101',
        end_date: '20231231',
        report_type: '4',
      }),
    );
  });

  it('uses stored official evidence for the corrected version only', async () => {
    mocks.incomeVip.mockImplementation(async (_client, _period, reportType) =>
      reportType === '1'
        ? [
            statementRow('1', {
              ann_date: '20231028',
              f_ann_date: '20231028',
              end_date: '20230930',
              update_flag: '0',
              oper_cost: 769_683_060.02,
            }),
            statementRow('1', {
              ann_date: '20231028',
              f_ann_date: '20240103',
              end_date: '20230930',
              update_flag: '1',
              oper_cost: 686_727_655.94,
            }),
          ]
        : [],
    );
    const database = createDatabase(
      ['20231030', '20240104'],
      [
        {
          sourceId: '1218790667',
          tsCode: '000858.SZ',
          publishedAt: new Date('2024-01-02T16:00:00.000Z'),
          publishedDate: '20240103',
          title: 'Financial correction',
          documentUrl: 'https://static.cninfo.com.cn/finalpage/2024-01-03/1218790667.PDF',
          affectedPeriods: ['20230930'],
          sourceFingerprint: 'fingerprint',
        },
      ],
    );

    await syncFinancialStatementsVip(client, ['20230930'], {}, database as never);

    expect(database.income.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fAnnDate: '20231028',
          availabilityQuality: 'conservative',
          evidenceId: null,
        }),
        expect.objectContaining({
          fAnnDate: '20240103',
          availabilityQuality: 'exact',
          evidenceId: '1218790667',
        }),
      ]),
    );
  });

  it('stores only evidence with PDF-verified affected periods', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const income = evidenceStatementDelegate(['income-version']);
    const balance = evidenceStatementDelegate(['balance-version-1', 'balance-version-2']);
    const cashFlow = evidenceStatementDelegate([]);
    const database = {
      financialCorrectionEvidence: { upsert },
      financialIncomeStatement: income,
      financialBalanceSheet: balance,
      financialCashFlowStatement: cashFlow,
    };
    const evidence: FinancialCorrectionEvidence = {
      source: 'cninfo',
      sourceId: '1218790667',
      tsCode: '300266.SZ',
      publishedAt: '2024-01-02T16:00:00.000Z',
      publishedDate: '20240103',
      title: 'Financial correction',
      documentUrl: 'https://static.cninfo.com.cn/finalpage/2024-01-03/1218790667.PDF',
      affectedPeriods: ['20230930'],
      sourceFingerprint: 'fingerprint',
    };

    await expect(
      storeFinancialCorrectionEvidence(
        [evidence],
        new Date('2024-01-03T01:00:00Z'),
        database as never,
      ),
    ).resolves.toBe(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source_sourceId: { source: 'cninfo', sourceId: '1218790667' } },
        create: expect.objectContaining({ affectedPeriods: ['20230930'] }),
      }),
    );
    expect(income.update).toHaveBeenCalledWith({
      where: { id: 'income-version' },
      data: {
        availabilityQuality: 'exact',
        evidenceSource: 'cninfo_announcement',
        evidenceId: '1218790667',
      },
    });
    expect(balance.update).not.toHaveBeenCalled();
    expect(cashFlow.update).not.toHaveBeenCalled();

    await expect(
      storeFinancialCorrectionEvidence(
        [{ ...evidence, affectedPeriods: [] }],
        new Date('2024-01-03T01:00:00Z'),
        database as never,
      ),
    ).rejects.toThrow('has no verified periods');
  });
});

function evidenceStatementDelegate(ids: string[]) {
  return {
    findMany: vi.fn().mockResolvedValue(ids.map((id) => ({ id }))),
    update: vi.fn().mockResolvedValue({}),
  };
}

function statementRow(reportType: '1' | '4' | '5', values: Record<string, unknown>) {
  return {
    ts_code: '000858.SZ',
    ann_date: '20230429',
    f_ann_date: '20230429',
    end_date: '20221231',
    report_type: reportType,
    comp_type: '1',
    update_flag: '0',
    ...values,
  };
}

function createDatabase(sessions: string[], evidence: Array<Record<string, unknown>> = []) {
  const income = appendOnlyDelegate();
  const balance = appendOnlyDelegate();
  const cash = appendOnlyDelegate();
  return {
    income,
    balance,
    cash,
    tradeCal: {
      findMany: vi.fn().mockResolvedValue(sessions.map((calDate) => ({ calDate }))),
    },
    financialCorrectionEvidence: {
      findMany: vi.fn().mockResolvedValue(evidence),
    },
    financialIncomeStatement: income,
    financialBalanceSheet: balance,
    financialCashFlowStatement: cash,
  };
}

function appendOnlyDelegate() {
  const rows: Array<Record<string, unknown> & { sourceRowFingerprint: string }> = [];
  return {
    rows,
    findMany: vi.fn(async (args) => {
      const fingerprints = new Set(args.where.sourceRowFingerprint.in);
      return rows
        .filter((row) => fingerprints.has(row.sourceRowFingerprint))
        .map((row) => ({ sourceRowFingerprint: row.sourceRowFingerprint }));
    }),
    createMany: vi.fn(async (args) => {
      rows.push(...args.data);
      return { count: args.data.length };
    }),
  };
}
