import { describe, expect, it } from 'vitest';

import { FINANCIAL_FORMULA_VERSION, calculateFinancialMetrics } from './metrics.js';
import type {
  ResolvedBalanceSheet,
  ResolvedCashFlowStatement,
  ResolvedFinancialPeriod,
  ResolvedFinancialState,
  ResolvedIncomeStatement,
} from './resolver.js';

describe('financial metrics kernel', () => {
  it('matches the hand-calculated TTM, ROIC, reinvestment, FCFF, and EV fixture', () => {
    const result = calculateFinancialMetrics(state());
    const metrics = result.periods.find((period) => period.endDate === '20241231')!.metrics;

    expect(metrics.revenue.value).toBeCloseTo(700);
    expect(metrics.revenueGrowthYoY.value).toBeCloseTo(0.4);
    expect(metrics.effectiveTaxRate.value).toBeCloseTo(0.25);
    expect(metrics.ebitProxy.value).toBeCloseTo(140);
    expect(metrics.nopat.value).toBeCloseTo(105);
    expect(metrics.workingCapital.value).toBeCloseTo(520);
    expect(metrics.investedCapital.value).toBeCloseTo(1_300);
    expect(metrics.returnOnInvestedCapital.value).toBeCloseTo(105 / 1_180);
    expect(metrics.netCapitalExpenditure.value).toBeCloseTo(25);
    expect(metrics.changeInWorkingCapital.value).toBeCloseTo(100);
    expect(metrics.reinvestment.value).toBeCloseTo(125);
    expect(metrics.freeCashFlowToFirm.value).toBeCloseTo(-20);
    expect(metrics.cashFreeCashFlow.value).toBeCloseTo(130);
    expect(metrics.netDebt.value).toBeCloseTo(250);
    expect(metrics.enterpriseValue.value).toBeCloseTo(2_300);
    expect(metrics.returnOnAssets.value).toBeCloseTo(105 / 1_395);
    expect(metrics.returnOnEquity.value).toBeCloseTo(100 / 900);
    expect(metrics.revenue.formulaVersion).toBe(FINANCIAL_FORMULA_VERSION);
    expect(metrics.freeCashFlowToFirm.inputVersions.length).toBeGreaterThan(0);
  });

  it('does not manufacture TTM or FCFF when a quarter is missing', () => {
    const input = state();
    const missingQuarter = input.periods.find((period) => period.endDate === '20240630')!;
    missingQuarter.income = null;
    missingQuarter.cashFlow = null;

    const result = calculateFinancialMetrics(input);
    const metrics = result.periods.find((period) => period.endDate === '20240930')!.metrics;

    expect(metrics.revenue).toMatchObject({
      value: null,
      status: 'missing',
      missingReason: 'incomplete_trailing_twelve_months',
    });
    expect(metrics.freeCashFlowToFirm.value).toBeNull();
  });

  it('uses the disclosed EBIT proxy and leaves FCFF missing when annual D&A is unavailable', () => {
    const input = state();
    const latest = input.periods.at(-1)!;
    latest.income!.values.finExpIntExp = 10;
    latest.income!.values.ebit = 999;
    latest.cashFlow!.values.deprFaCogaDpba = null;

    const result = calculateFinancialMetrics(input);
    const metrics = result.periods.find((period) => period.endDate === '20241231')!.metrics;

    expect(metrics.ebitProxy.value).toBeCloseTo(150);
    expect(metrics.netCapitalExpenditure).toMatchObject({
      value: null,
      status: 'missing',
      missingReason: 'missing_current_cumulative_value',
    });
    expect(metrics.freeCashFlowToFirm).toMatchObject({
      value: null,
      status: 'missing',
      missingReason: 'missing_current_cumulative_value',
    });
    expect(metrics.cashFreeCashFlow.value).toBeCloseTo(130);
  });

  it('marks ROIC invalid when average invested capital is non-positive', () => {
    const input = state();
    for (const period of input.periods) {
      if (period.balanceSheet) {
        period.balanceSheet.values.moneyCap = 2_000;
      }
    }

    const result = calculateFinancialMetrics(input);
    const metrics = result.periods.find((period) => period.endDate === '20241231')!.metrics;

    expect(metrics.returnOnInvestedCapital).toMatchObject({
      value: null,
      status: 'invalid',
      missingReason: 'non_positive_average_invested_capital',
    });
  });

  it('is byte-deterministic for the same inputs and changes fingerprint with an input version', () => {
    const first = calculateFinancialMetrics(state());
    const repeated = calculateFinancialMetrics(state());
    const changedInput = state();
    changedInput.periods.at(-1)!.income!.sourceRowFingerprint = 'changed-version';
    const changed = calculateFinancialMetrics(changedInput);

    expect(repeated).toEqual(first);
    expect(changed.resultFingerprint).not.toBe(first.resultFingerprint);
  });

  it('returns no industrial metrics for a financial company', () => {
    const input = state();
    input.applicability = 'unsupported_financial';
    input.periods = [];
    input.diagnostics = [
      {
        code: 'unsupported_financial_company',
        severity: 'error',
        message: 'Not applicable.',
      },
    ];

    const result = calculateFinancialMetrics(input);

    expect(result.periods).toEqual([]);
    expect(result.diagnostics[0].code).toBe('unsupported_financial_company');
  });

  it('quarantines negative capex dependencies without changing source data or unrelated metrics', () => {
    const input = state();
    input.periods.at(-1)!.cashFlow!.values.cPayAcqConstFiolta = -10;
    const before = structuredClone(input);
    const result = calculateFinancialMetrics(input);
    const metrics = result.periods.at(-1)!.metrics;
    expect(metrics.cashFreeCashFlow).toMatchObject({
      value: null,
      status: 'invalid',
      missingReason: 'accounting_review_required:negative_cash_capex_requires_review',
    });
    expect(metrics.freeCashFlowToFirm.value).toBeNull();
    expect(metrics.operatingCashFlow.value).toBe(180);
    expect(metrics.revenue.value).toBe(700);
    expect(input).toEqual(before);
  });

  it('propagates a quarantined historical cash quarter through TTM lineage', () => {
    const input = state();
    input.periods.find(
      (period) => period.endDate === '20240331',
    )!.cashFlow!.values.cPayAcqConstFiolta = -5;
    const result = calculateFinancialMetrics(input);
    const metrics = result.periods.find((period) => period.endDate === '20240930')!.metrics;
    expect(metrics.cashFreeCashFlow.status).toBe('invalid');
    expect(metrics.operatingCashFlow.status).toBe('ok');
    expect(
      result.periods.find((period) => period.endDate === '20231231')!.metrics.cashFreeCashFlow
        .status,
    ).toBe('ok');
  });

  it('propagates a prior balance problem into dependent metrics but not revenue', () => {
    const input = state();
    input.periods.find(
      (period) => period.endDate === '20231231',
    )!.balanceSheet!.values.totalAssets = 999;
    const metrics = calculateFinancialMetrics(input).periods.at(-1)!.metrics;
    expect(metrics.returnOnInvestedCapital.status).toBe('invalid');
    expect(metrics.revenue.status).toBe('ok');
  });

  it('does not call a reconciling negative non-current liability subtotal an arithmetic error', () => {
    const input = state();
    const values = input.periods.at(-1)!.balanceSheet!.values;
    values.totalCurLiab = 600;
    values.totalNcl = -100;
    const result = calculateFinancialMetrics(input);
    expect(
      result.diagnostics.some(
        (issue) => issue.code === 'negative_non_current_liabilities_disclosed',
      ),
    ).toBe(true);
    expect(result.periods.at(-1)!.metrics.workingCapital.status).toBe('ok');
  });

  it('quarantines unexplained liability subtotals only along working-capital dependencies', () => {
    const input = state();
    input.periods.at(-1)!.balanceSheet!.values.totalCurLiab = 600;
    const metrics = calculateFinancialMetrics(input).periods.at(-1)!.metrics;
    expect(metrics.workingCapital.status).toBe('invalid');
    expect(metrics.freeCashFlowToFirm.status).toBe('invalid');
    expect(metrics.nopat.status).toBe('ok');
    expect(metrics.cashFreeCashFlow.status).toBe('ok');
  });

  it('compares selected cross-statement profits and blocks profit-ratio consumers only', () => {
    const input = state();
    input.periods.at(-1)!.cashFlow!.values.netProfit = 999;
    const result = calculateFinancialMetrics(input);
    const metrics = result.periods.at(-1)!.metrics;
    expect(metrics.returnOnAssets.status).toBe('invalid');
    expect(metrics.accrualRatio.status).toBe('invalid');
    expect(metrics.operatingCashFlowToNetIncome.status).toBe('invalid');
    expect(metrics.nopat.status).toBe('ok');
    expect(metrics.returnOnEquity.status).toBe('ok');
  });

  it('warns on cash reconciliation without blocking unrelated operating cash flow', () => {
    const input = state();
    Object.assign(input.periods.at(-1)!.cashFlow!.values, {
      cCashEquBegPeriod: 10,
      nIncrCashCashEqu: 5,
      cCashEquEndPeriod: 99,
    });
    const result = calculateFinancialMetrics(input);
    expect(result.diagnostics.some((issue) => issue.code === 'cash_flow_identity_mismatch')).toBe(
      true,
    );
    expect(result.periods.at(-1)!.metrics.operatingCashFlow.status).toBe('ok');
  });
});

function state(): ResolvedFinancialState {
  const dates = [
    '20230331',
    '20230630',
    '20230930',
    '20231231',
    '20240331',
    '20240630',
    '20240930',
    '20241231',
  ];
  const revenue = [100, 220, 360, 500, 150, 310, 480, 700];
  const operatingCost = [60, 132, 216, 300, 90, 186, 288, 420];
  const operatingProfit = [20, 44, 72, 100, 30, 62, 96, 140];
  const incomeTax = [5, 11, 18, 25, 7.5, 15.5, 24, 35];
  const parentNetIncome = [15, 33, 54, 75, 22, 46, 70, 100];
  const operatingCashFlow = [20, 40, 70, 100, 30, 70, 120, 180];
  const capitalExpenditure = [5, 10, 15, 20, 10, 20, 35, 50];
  const depreciation = [2, 4, 6, 8, 5, 10, 15, 20];
  const amortization = [1, 2, 3, 4, 1.25, 2.5, 3.75, 5];
  const periods: ResolvedFinancialPeriod[] = dates.map((endDate, index) => ({
    endDate,
    income: income(endDate, {
      revenue: revenue[index],
      operCost: operatingCost[index],
      operateProfit: operatingProfit[index],
      totalProfit: operatingProfit[index],
      incomeTax: incomeTax[index],
      nIncome: operatingProfit[index] * 0.75,
      nIncomeAttrP: parentNetIncome[index],
    }),
    balanceSheet:
      endDate === '20231231'
        ? balance(endDate, {
            moneyCap: 80,
            totalCurAssets: 800,
            totalCurLiab: 400,
            stBorr: 80,
            nonCurLiabDue1y: 20,
            ltBorr: 170,
            bondPayable: 30,
            totalLiab: 400,
            minorityInt: 40,
            totalHldrEqyExcMinInt: 800,
            totalAssets: 1_240,
            totalShare: 100,
          })
        : endDate === '20241231'
          ? balance(endDate, {
              moneyCap: 100,
              totalCurAssets: 1_000,
              totalCurLiab: 500,
              stBorr: 100,
              nonCurLiabDue1y: 20,
              ltBorr: 200,
              bondPayable: 30,
              totalLiab: 500,
              minorityInt: 50,
              totalHldrEqyExcMinInt: 1_000,
              totalAssets: 1_550,
              totalShare: 100,
            })
          : null,
    cashFlow: cashFlow(endDate, {
      nCashflowAct: operatingCashFlow[index],
      cPayAcqConstFiolta: capitalExpenditure[index],
      deprFaCogaDpba: depreciation[index],
      amortIntangAssets: amortization[index],
    }),
  }));
  return {
    resolverVersion: 1,
    tsCode: '000858.SZ',
    asOfDate: '20250501',
    strictPit: true,
    industry: { l1Code: '801120.SI', l1Name: '食品饮料' },
    applicability: 'industrial',
    periods,
    market: {
      tradeDate: '20250430',
      marketCapitalization: 2_000,
      sourceIdentity: 'daily_basic:000858.SZ:20250430',
    },
    diagnostics: [],
  };
}

function income(
  endDate: string,
  values: Partial<ResolvedIncomeStatement['values']>,
): ResolvedIncomeStatement {
  return {
    ...metadata('income', endDate),
    statementKind: 'income',
    values: {
      totalRevenue: null,
      revenue: null,
      operCost: null,
      operateProfit: null,
      totalProfit: null,
      incomeTax: null,
      nIncome: null,
      nIncomeAttrP: null,
      ebit: null,
      rdExp: null,
      finExpIntExp: 0,
      ...values,
    },
  };
}

function balance(
  endDate: string,
  values: Partial<ResolvedBalanceSheet['values']>,
): ResolvedBalanceSheet {
  return {
    ...metadata('balance_sheet', endDate),
    statementKind: 'balance_sheet',
    values: {
      moneyCap: null,
      tradAsset: null,
      notesReceiv: null,
      accountsReceiv: null,
      accountsReceivBill: null,
      othReceiv: null,
      othRcvTotal: null,
      inventories: null,
      prepayment: null,
      contractAssets: null,
      othCurAssets: null,
      totalCurAssets: null,
      fixAssets: null,
      fixAssetsTotal: null,
      cip: null,
      cipTotal: null,
      intanAssets: null,
      goodwill: null,
      deferTaxAssets: null,
      othNca: null,
      totalNca: null,
      totalAssets: null,
      notesPayable: null,
      acctPayable: null,
      accountsPay: null,
      advReceipts: null,
      contractLiab: null,
      payrollPayable: null,
      taxesPayable: null,
      othPayable: null,
      othPayTotal: null,
      stBorr: null,
      nonCurLiabDue1y: null,
      ltBorr: null,
      bondPayable: null,
      othCurLiab: null,
      totalCurLiab: null,
      othNcl: null,
      totalNcl: null,
      totalLiab: null,
      minorityInt: null,
      totalHldrEqyExcMinInt: null,
      totalShare: null,
      ...values,
    },
  };
}

function cashFlow(
  endDate: string,
  values: Partial<ResolvedCashFlowStatement['values']>,
): ResolvedCashFlowStatement {
  return {
    ...metadata('cash_flow', endDate),
    statementKind: 'cash_flow',
    values: {
      nCashflowAct: null,
      cPayAcqConstFiolta: null,
      nCashflowInvAct: null,
      nCashFlowsFncAct: null,
      cPayDistDpcpIntExp: null,
      nIncrCashCashEqu: null,
      cCashEquBegPeriod: null,
      cCashEquEndPeriod: null,
      netProfit: null,
      deprFaCogaDpba: null,
      amortIntangAssets: null,
      freeCashflow: null,
      ...values,
    },
  };
}

function metadata(statementKind: 'income' | 'balance_sheet' | 'cash_flow', endDate: string) {
  return {
    id: `${statementKind}-${endDate}`,
    source: 'tushare',
    contractVersion: 1,
    tsCode: '000858.SZ',
    endDate,
    announcementDate: '20250426',
    availableDate: '20250428',
    availabilityQuality: 'conservative' as const,
    reportType: '1' as const,
    compType: '1' as const,
    updateFlag: '0',
    sourceRowFingerprint: `${statementKind}-${endDate}`,
  };
}
