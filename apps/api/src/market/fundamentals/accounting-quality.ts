import type { ResearchFinancialMetricV1 } from '@jixie/shared';
import type { FinancialDiagnostic, ResolvedFinancialPeriod } from './resolver.js';

export interface FinancialAccountingIssue {
  diagnostic: FinancialDiagnostic;
  inputVersions: string[];
  affectedMetrics: readonly ResearchFinancialMetricV1[];
}

const WORKING_CAPITAL_METRICS: readonly ResearchFinancialMetricV1[] = [
  'workingCapital',
  'changeInWorkingCapital',
  'reinvestment',
  'reinvestmentRate',
  'freeCashFlowToFirm',
];
const CAPITAL_EXPENDITURE_METRICS: readonly ResearchFinancialMetricV1[] = [
  'netCapitalExpenditure',
  'reinvestment',
  'reinvestmentRate',
  'freeCashFlowToFirm',
  'cashFreeCashFlow',
];
const BALANCE_METRICS: readonly ResearchFinancialMetricV1[] = [
  ...WORKING_CAPITAL_METRICS,
  'returnOnAssets',
  'returnOnEquity',
  'investedCapital',
  'capitalTurnover',
  'returnOnInvestedCapital',
  'accrualRatio',
  'cashAndEquivalents',
  'interestBearingDebt',
  'netDebt',
  'debtToInvestedCapital',
  'enterpriseValue',
  'issuedShares',
];

/** Inspect selected versions, not all combinations of stored source rows. */
export function inspectFinancialAccounting(
  period: ResolvedFinancialPeriod,
): FinancialAccountingIssue[] {
  const issues: FinancialAccountingIssue[] = [];
  const add = (
    code: string,
    message: string,
    statements: NonNullable<ResolvedFinancialPeriod['income' | 'balanceSheet' | 'cashFlow']>[],
    affectedMetrics: readonly ResearchFinancialMetricV1[],
  ) => {
    issues.push({
      diagnostic: {
        code,
        severity: 'warning',
        message,
        endDate: period.endDate,
        ...(statements.length === 1 ? { statementKind: statements[0].statementKind } : {}),
      },
      inputVersions: statements.map((statement) => statement.sourceRowFingerprint),
      affectedMetrics,
    });
  };

  const balance = period.balanceSheet;
  if (balance) {
    const values = balance.values;
    if (
      values.totalAssets != null &&
      values.totalLiab != null &&
      values.totalHldrEqyExcMinInt != null &&
      !financialValuesAgree(
        values.totalAssets,
        values.totalLiab + values.totalHldrEqyExcMinInt + (values.minorityInt ?? 0),
      )
    ) {
      add(
        'balance_sheet_identity_mismatch',
        'Assets do not reconcile to liabilities plus equity; affected balance-based metrics require review.',
        [balance],
        BALANCE_METRICS,
      );
    }
    if (values.totalAssets != null && values.totalAssets <= 0) {
      add(
        'non_positive_total_assets',
        'Non-positive total assets require source review.',
        [balance],
        ['returnOnAssets', 'accrualRatio'],
      );
    }
    if (values.totalShare != null && values.totalShare <= 0) {
      add(
        'non_positive_issued_shares',
        'Non-positive issued shares cannot support per-share valuation.',
        [balance],
        ['issuedShares'],
      );
    }
    if (values.totalLiab != null && values.totalLiab < 0) {
      add(
        'negative_total_liabilities_requires_review',
        'Negative total liabilities require source and accounting-scope review.',
        [balance],
        BALANCE_METRICS,
      );
    }
    if (
      values.totalCurAssets != null &&
      values.totalAssets != null &&
      values.totalCurAssets > values.totalAssets &&
      !financialValuesAgree(values.totalCurAssets, values.totalAssets)
    ) {
      add(
        'current_assets_exceed_total_requires_review',
        'Current assets exceed total assets; working-capital assumptions require review.',
        [balance],
        WORKING_CAPITAL_METRICS,
      );
    }
    if (
      values.totalCurLiab != null &&
      values.totalLiab != null &&
      values.totalCurLiab > values.totalLiab &&
      !financialValuesAgree(values.totalCurLiab, values.totalLiab)
    ) {
      if (
        values.totalNcl != null &&
        values.totalNcl < 0 &&
        financialValuesAgree(values.totalCurLiab + values.totalNcl, values.totalLiab)
      ) {
        add(
          'negative_non_current_liabilities_disclosed',
          'Negative non-current liabilities explain the subtotal relationship; review the disclosure, but do not treat it as an arithmetic error.',
          [balance],
          [],
        );
      } else {
        add(
          'current_liabilities_exceed_total_requires_review',
          'Current liabilities exceed total liabilities without a reconciling non-current subtotal.',
          [balance],
          WORKING_CAPITAL_METRICS,
        );
      }
    }
  }

  const cash = period.cashFlow;
  if (cash) {
    const values = cash.values;
    if (values.cPayAcqConstFiolta != null && values.cPayAcqConstFiolta < 0) {
      add(
        'negative_cash_capex_requires_review',
        'Negative disclosed cash capital expenditure requires explanation before use in investment metrics.',
        [cash],
        CAPITAL_EXPENDITURE_METRICS,
      );
    }
    if (
      values.cCashEquBegPeriod != null &&
      values.nIncrCashCashEqu != null &&
      values.cCashEquEndPeriod != null &&
      !financialValuesAgree(
        values.cCashEquBegPeriod + values.nIncrCashCashEqu,
        values.cCashEquEndPeriod,
      )
    ) {
      // These stock/reconciliation fields are not operands of current historical metrics.
      add(
        'cash_flow_identity_mismatch',
        'Beginning cash plus net increase does not reconcile to ending cash.',
        [cash],
        [],
      );
    }
  }

  const income = period.income;
  if (
    income &&
    cash &&
    income.values.nIncome != null &&
    cash.values.netProfit != null &&
    !financialValuesAgree(income.values.nIncome, cash.values.netProfit)
  ) {
    add(
      'cross_statement_net_income_mismatch',
      'Selected income and cash-flow versions disagree on net income; neither value is silently preferred for affected metrics.',
      [income, cash],
      ['returnOnAssets', 'operatingCashFlowToNetIncome', 'accrualRatio'],
    );
  }

  return issues;
}

export function financialValuesAgree(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1, Math.max(Math.abs(left), Math.abs(right)) * 1e-6);
}
