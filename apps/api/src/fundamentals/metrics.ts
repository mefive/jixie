import { createHash } from 'node:crypto';

import {
  normalizeCashFlows,
  normalizeIncomeFlows,
  isStandardFinancialPeriod,
  previousYearPeriod,
  type StandardizedFinancialValue,
} from './normalize.js';
import type {
  FinancialDiagnostic,
  ResolvedBalanceSheet,
  ResolvedFinancialPeriod,
  ResolvedFinancialState,
} from './resolver.js';

export const FINANCIAL_FORMULA_VERSION = 'financial-metrics-v1';

export type FinancialMetricConcept =
  | 'revenue'
  | 'revenueGrowthYoY'
  | 'revenueCagr3y'
  | 'grossMargin'
  | 'operatingProfit'
  | 'ebitProxy'
  | 'operatingMargin'
  | 'effectiveTaxRate'
  | 'nopat'
  | 'nopatMargin'
  | 'returnOnAssets'
  | 'returnOnEquity'
  | 'workingCapital'
  | 'investedCapital'
  | 'capitalTurnover'
  | 'returnOnInvestedCapital'
  | 'netCapitalExpenditure'
  | 'changeInWorkingCapital'
  | 'reinvestment'
  | 'reinvestmentRate'
  | 'operatingCashFlow'
  | 'freeCashFlowToFirm'
  | 'cashFreeCashFlow'
  | 'operatingCashFlowToNetIncome'
  | 'accrualRatio'
  | 'cashAndEquivalents'
  | 'interestBearingDebt'
  | 'netDebt'
  | 'debtToInvestedCapital'
  | 'marketCapitalization'
  | 'enterpriseValue'
  | 'issuedShares';

export type FinancialMetricUnit = 'CNY' | 'shares' | 'ratio';
export type FinancialMetricStatus = 'ok' | 'missing' | 'invalid' | 'not_applicable';

export interface FinancialMetricResult {
  concept: FinancialMetricConcept;
  value: number | null;
  unit: FinancialMetricUnit;
  status: FinancialMetricStatus;
  formula: string;
  formulaVersion: typeof FINANCIAL_FORMULA_VERSION;
  inputVersions: string[];
  missingReason?: string;
}

export interface FinancialPeriodMetrics {
  endDate: string;
  metrics: Record<FinancialMetricConcept, FinancialMetricResult>;
}

export interface FinancialMetricsResult {
  formulaVersion: typeof FINANCIAL_FORMULA_VERSION;
  resolverVersion: number;
  tsCode: string;
  asOfDate: string;
  periods: FinancialPeriodMetrics[];
  diagnostics: FinancialDiagnostic[];
  resultFingerprint: string;
}

interface Operand {
  value: number | null;
  inputVersions: string[];
  missingReason?: string;
  invalidReason?: string;
}

const METRIC_DEFINITIONS: Record<
  FinancialMetricConcept,
  { unit: FinancialMetricUnit; formula: string }
> = {
  revenue: { unit: 'CNY', formula: 'TTM operating revenue' },
  revenueGrowthYoY: { unit: 'ratio', formula: 'TTM revenue / prior-year TTM revenue - 1' },
  revenueCagr3y: {
    unit: 'ratio',
    formula: '(TTM revenue / TTM revenue three years earlier)^(1/3) - 1',
  },
  grossMargin: { unit: 'ratio', formula: '(TTM revenue - TTM operating cost) / TTM revenue' },
  operatingProfit: { unit: 'CNY', formula: 'TTM operating profit' },
  ebitProxy: { unit: 'CNY', formula: 'TTM operating profit + TTM interest expense' },
  operatingMargin: { unit: 'ratio', formula: 'TTM operating profit / TTM revenue' },
  effectiveTaxRate: { unit: 'ratio', formula: 'TTM income tax expense / TTM total profit' },
  nopat: {
    unit: 'CNY',
    formula: 'V1 EBIT proxy × (1 - effective tax rate)',
  },
  nopatMargin: { unit: 'ratio', formula: 'NOPAT / TTM revenue' },
  returnOnAssets: { unit: 'ratio', formula: 'TTM net income / average total assets' },
  returnOnEquity: {
    unit: 'ratio',
    formula: 'TTM net income attributable to parent / average equity attributable to parent',
  },
  workingCapital: {
    unit: 'CNY',
    formula:
      '(current assets - cash - trading financial assets) - (current liabilities - current interest-bearing debt)',
  },
  investedCapital: {
    unit: 'CNY',
    formula:
      'parent equity + minority interests + interest-bearing debt - cash - trading financial assets',
  },
  capitalTurnover: { unit: 'ratio', formula: 'TTM revenue / average invested capital' },
  returnOnInvestedCapital: { unit: 'ratio', formula: 'NOPAT / average invested capital' },
  netCapitalExpenditure: {
    unit: 'CNY',
    formula: 'TTM cash capital expenditure - TTM depreciation - TTM amortization',
  },
  changeInWorkingCapital: {
    unit: 'CNY',
    formula: 'ending operating working capital - prior-year operating working capital',
  },
  reinvestment: {
    unit: 'CNY',
    formula: 'net capital expenditure + change in operating working capital',
  },
  reinvestmentRate: { unit: 'ratio', formula: 'reinvestment / NOPAT' },
  operatingCashFlow: { unit: 'CNY', formula: 'TTM net cash flow from operating activities' },
  freeCashFlowToFirm: { unit: 'CNY', formula: 'NOPAT - reinvestment' },
  cashFreeCashFlow: {
    unit: 'CNY',
    formula: 'TTM operating cash flow - TTM cash capital expenditure',
  },
  operatingCashFlowToNetIncome: {
    unit: 'ratio',
    formula: 'TTM operating cash flow / TTM net income',
  },
  accrualRatio: {
    unit: 'ratio',
    formula: '(TTM net income - TTM operating cash flow) / average total assets',
  },
  cashAndEquivalents: { unit: 'CNY', formula: 'balance-sheet cash and cash equivalents' },
  interestBearingDebt: {
    unit: 'CNY',
    formula:
      'short-term borrowings + current portion of non-current liabilities + long-term borrowings + bonds payable',
  },
  netDebt: { unit: 'CNY', formula: 'interest-bearing debt - cash and cash equivalents' },
  debtToInvestedCapital: { unit: 'ratio', formula: 'interest-bearing debt / invested capital' },
  marketCapitalization: { unit: 'CNY', formula: 'DailyBasic.totalMv × 10,000' },
  enterpriseValue: {
    unit: 'CNY',
    formula:
      'market capitalization + interest-bearing debt + minority interests - cash - trading financial assets',
  },
  issuedShares: { unit: 'shares', formula: 'balance-sheet issued shares' },
};

/** Calculate deterministic historical metrics without persisting a derived snapshot. */
export function calculateFinancialMetrics(state: ResolvedFinancialState): FinancialMetricsResult {
  const diagnostics = [...state.diagnostics];
  if (state.applicability === 'unsupported_financial') {
    const result = baseResult(state, [], diagnostics);
    return { ...result, resultFingerprint: fingerprintResult(result) };
  }

  const incomeRows = state.periods.flatMap((period) => (period.income ? [period.income] : []));
  const cashFlowRows = state.periods.flatMap((period) =>
    period.cashFlow ? [period.cashFlow] : [],
  );
  const incomeFlows = normalizeIncomeFlows(incomeRows);
  const cashFlows = normalizeCashFlows(cashFlowRows);
  diagnostics.push(...incomeFlows.diagnostics, ...cashFlows.diagnostics);
  const incomeTtmByPeriod = new Map(
    incomeFlows.trailingTwelveMonths.map((flow) => [flow.endDate, flow]),
  );
  const cashTtmByPeriod = new Map(
    cashFlows.trailingTwelveMonths.map((flow) => [flow.endDate, flow]),
  );
  const periodsByDate = new Map(state.periods.map((period) => [period.endDate, period]));
  const latestPeriod = state.periods.at(-1)?.endDate;
  const periods = state.periods.map((period) => {
    diagnostics.push(...accountingDiagnostics(period));
    if (!isStandardFinancialPeriod(period.endDate)) {
      return {
        endDate: period.endDate,
        metrics: missingPeriodMetrics('non_standard_report_period'),
      };
    }
    const priorYear = periodsByDate.get(previousYearPeriod(period.endDate));
    const incomeTtm = incomeTtmByPeriod.get(period.endDate);
    const priorIncomeTtm = incomeTtmByPeriod.get(previousYearPeriod(period.endDate));
    const threeYearIncomeTtm = incomeTtmByPeriod.get(previousYearPeriod(period.endDate, 3));
    const cashTtm = cashTtmByPeriod.get(period.endDate);
    return {
      endDate: period.endDate,
      metrics: calculatePeriodMetrics({
        period,
        priorYear,
        incomeTtm,
        priorIncomeTtm,
        threeYearIncomeTtm,
        cashTtm,
        state,
        includeMarketBridge: period.endDate === latestPeriod,
      }),
    };
  });
  appendMetricDiagnostics(periods, diagnostics);

  const result = baseResult(state, periods, diagnostics);
  return { ...result, resultFingerprint: fingerprintResult(result) };
}

interface PeriodCalculationInput {
  period: ResolvedFinancialPeriod;
  priorYear: ResolvedFinancialPeriod | undefined;
  incomeTtm: ReturnType<typeof normalizeIncomeFlows>['trailingTwelveMonths'][number] | undefined;
  priorIncomeTtm:
    | ReturnType<typeof normalizeIncomeFlows>['trailingTwelveMonths'][number]
    | undefined;
  threeYearIncomeTtm:
    | ReturnType<typeof normalizeIncomeFlows>['trailingTwelveMonths'][number]
    | undefined;
  cashTtm: ReturnType<typeof normalizeCashFlows>['trailingTwelveMonths'][number] | undefined;
  state: ResolvedFinancialState;
  includeMarketBridge: boolean;
}

function calculatePeriodMetrics(
  input: PeriodCalculationInput,
): Record<FinancialMetricConcept, FinancialMetricResult> {
  const revenue = standardized(input.incomeTtm?.values.revenue, 'missing_ttm_revenue');
  const priorRevenue = standardized(
    input.priorIncomeTtm?.values.revenue,
    'missing_prior_year_ttm_revenue',
  );
  const threeYearRevenue = standardized(
    input.threeYearIncomeTtm?.values.revenue,
    'missing_three_year_ttm_revenue',
  );
  const operatingCost = standardized(
    input.incomeTtm?.values.operCost,
    'missing_ttm_operating_cost',
  );
  const operatingProfit = standardized(
    input.incomeTtm?.values.operateProfit,
    'missing_ttm_operating_profit',
  );
  const totalProfit = standardized(input.incomeTtm?.values.totalProfit, 'missing_ttm_total_profit');
  const incomeTax = standardized(input.incomeTtm?.values.incomeTax, 'missing_ttm_income_tax');
  const interestExpense = standardized(
    input.incomeTtm?.values.finExpIntExp,
    'missing_ttm_interest_expense',
  );
  const netIncome = standardized(input.incomeTtm?.values.nIncome, 'missing_ttm_net_income');
  const parentNetIncome = standardized(
    input.incomeTtm?.values.nIncomeAttrP,
    'missing_ttm_parent_net_income',
  );
  const operatingCashFlow = standardized(
    input.cashTtm?.values.nCashflowAct,
    'missing_ttm_operating_cash_flow',
  );
  const capitalExpenditure = standardized(
    input.cashTtm?.values.cPayAcqConstFiolta,
    'missing_ttm_capital_expenditure',
  );
  const depreciation = standardized(
    input.cashTtm?.values.deprFaCogaDpba,
    'missing_ttm_depreciation',
  );
  const amortization = standardized(
    input.cashTtm?.values.amortIntangAssets,
    'missing_ttm_amortization',
  );
  const currentWorkingCapital = workingCapital(input.period.balanceSheet);
  const priorWorkingCapital = workingCapital(input.priorYear?.balanceSheet ?? null);
  const currentInvestedCapital = investedCapital(input.period.balanceSheet);
  const priorInvestedCapital = investedCapital(input.priorYear?.balanceSheet ?? null);
  const currentTotalAssets = balanceValue(
    input.period.balanceSheet,
    'totalAssets',
    'missing_total_assets',
  );
  const priorTotalAssets = balanceValue(
    input.priorYear?.balanceSheet ?? null,
    'totalAssets',
    'missing_prior_year_total_assets',
  );
  const currentEquity = balanceValue(
    input.period.balanceSheet,
    'totalHldrEqyExcMinInt',
    'missing_parent_equity',
  );
  const priorEquity = balanceValue(
    input.priorYear?.balanceSheet ?? null,
    'totalHldrEqyExcMinInt',
    'missing_prior_year_parent_equity',
  );
  const cash = balanceValue(input.period.balanceSheet, 'moneyCap', 'missing_cash');
  const debt = interestBearingDebt(input.period.balanceSheet);
  const minorityInterest = optionalBalanceValue(input.period.balanceSheet, 'minorityInt');
  const tradingAssets = optionalBalanceValue(input.period.balanceSheet, 'tradAsset');
  const issuedShares = balanceValue(
    input.period.balanceSheet,
    'totalShare',
    'missing_issued_shares',
  );

  const averageInvestedCapital = mean(currentInvestedCapital, priorInvestedCapital);
  if (averageInvestedCapital.value != null && averageInvestedCapital.value <= 0) {
    averageInvestedCapital.invalidReason = 'non_positive_average_invested_capital';
  }
  const averageTotalAssets = mean(currentTotalAssets, priorTotalAssets);
  const averageEquity = mean(currentEquity, priorEquity);
  const effectiveTaxRate = ratio(
    totalProfit,
    totalProfit,
    incomeTax,
    (_profit, tax) => tax / _profit,
  );
  if (
    totalProfit.value != null &&
    (totalProfit.value <= 0 ||
      effectiveTaxRate.value == null ||
      effectiveTaxRate.value < 0 ||
      effectiveTaxRate.value > 1)
  ) {
    effectiveTaxRate.value = null;
    effectiveTaxRate.invalidReason = 'effective_tax_rate_out_of_range';
  }
  const ebitProxy = combine(
    [operatingProfit, interestExpense],
    (profit, interest) => profit + interest,
  );
  const nopat = combine(
    [ebitProxy, effectiveTaxRate],
    (earningsBeforeInterestAndTax, taxRate) => earningsBeforeInterestAndTax * (1 - taxRate),
  );
  const netCapitalExpenditure = combine(
    [capitalExpenditure, depreciation, amortization],
    (capitalSpending, depreciationExpense, amortizationExpense) =>
      capitalSpending - depreciationExpense - amortizationExpense,
  );
  const changeInWorkingCapital = combine(
    [currentWorkingCapital, priorWorkingCapital],
    (current, previous) => current - previous,
  );
  const reinvestment = combine(
    [netCapitalExpenditure, changeInWorkingCapital],
    (netCapitalSpending, workingCapitalChange) => netCapitalSpending + workingCapitalChange,
  );
  const marketCapitalization: Operand = input.includeMarketBridge
    ? input.state.market?.marketCapitalization == null
      ? missing('missing_market_capitalization')
      : {
          value: input.state.market.marketCapitalization,
          inputVersions: [input.state.market.sourceIdentity],
        }
    : missing('market_bridge_only_available_for_latest_financial_period');

  return {
    revenue: metric('revenue', revenue),
    revenueGrowthYoY: metric('revenueGrowthYoY', divideDifference(revenue, priorRevenue)),
    revenueCagr3y: metric('revenueCagr3y', cagr(revenue, threeYearRevenue, 3)),
    grossMargin: metric(
      'grossMargin',
      ratio(revenue, revenue, operatingCost, (sales, cost) => (sales - cost) / sales),
    ),
    operatingProfit: metric('operatingProfit', operatingProfit),
    ebitProxy: metric('ebitProxy', ebitProxy),
    operatingMargin: metric('operatingMargin', divide(operatingProfit, revenue)),
    effectiveTaxRate: metric('effectiveTaxRate', effectiveTaxRate),
    nopat: metric('nopat', nopat),
    nopatMargin: metric('nopatMargin', divide(nopat, revenue)),
    returnOnAssets: metric('returnOnAssets', divide(netIncome, averageTotalAssets)),
    returnOnEquity: metric('returnOnEquity', divide(parentNetIncome, averageEquity)),
    workingCapital: metric('workingCapital', currentWorkingCapital),
    investedCapital: metric('investedCapital', currentInvestedCapital),
    capitalTurnover: metric('capitalTurnover', divide(revenue, averageInvestedCapital)),
    returnOnInvestedCapital: metric(
      'returnOnInvestedCapital',
      divide(nopat, averageInvestedCapital),
    ),
    netCapitalExpenditure: metric('netCapitalExpenditure', netCapitalExpenditure),
    changeInWorkingCapital: metric('changeInWorkingCapital', changeInWorkingCapital),
    reinvestment: metric('reinvestment', reinvestment),
    reinvestmentRate: metric('reinvestmentRate', divide(reinvestment, nopat)),
    operatingCashFlow: metric('operatingCashFlow', operatingCashFlow),
    freeCashFlowToFirm: metric(
      'freeCashFlowToFirm',
      combine(
        [nopat, reinvestment],
        (afterTaxOperatingProfit, investment) => afterTaxOperatingProfit - investment,
      ),
    ),
    cashFreeCashFlow: metric(
      'cashFreeCashFlow',
      combine(
        [operatingCashFlow, capitalExpenditure],
        (cashFlow, capitalSpending) => cashFlow - capitalSpending,
      ),
    ),
    operatingCashFlowToNetIncome: metric(
      'operatingCashFlowToNetIncome',
      divide(operatingCashFlow, netIncome),
    ),
    accrualRatio: metric(
      'accrualRatio',
      combine(
        [netIncome, operatingCashFlow, averageTotalAssets],
        (profit, cashFlow, assets) => (profit - cashFlow) / assets,
      ),
    ),
    cashAndEquivalents: metric('cashAndEquivalents', cash),
    interestBearingDebt: metric('interestBearingDebt', debt),
    netDebt: metric(
      'netDebt',
      combine([debt, cash], (interestDebt, cashBalance) => interestDebt - cashBalance),
    ),
    debtToInvestedCapital: metric('debtToInvestedCapital', divide(debt, currentInvestedCapital)),
    marketCapitalization: metric('marketCapitalization', marketCapitalization),
    enterpriseValue: metric(
      'enterpriseValue',
      combine(
        [marketCapitalization, debt, minorityInterest, cash, tradingAssets],
        (marketValue, interestDebt, minority, cashBalance, financialAssets) =>
          marketValue + interestDebt + minority - cashBalance - financialAssets,
      ),
    ),
    issuedShares: metric('issuedShares', issuedShares),
  };
}

function metric(concept: FinancialMetricConcept, operand: Operand): FinancialMetricResult {
  const definition = METRIC_DEFINITIONS[concept];
  const status: FinancialMetricStatus = operand.invalidReason
    ? 'invalid'
    : operand.value == null
      ? 'missing'
      : 'ok';
  return {
    concept,
    value: operand.value,
    unit: definition.unit,
    status,
    formula: definition.formula,
    formulaVersion: FINANCIAL_FORMULA_VERSION,
    inputVersions: sortedUnique(operand.inputVersions),
    ...((operand.invalidReason || operand.missingReason) && {
      missingReason: operand.invalidReason ?? operand.missingReason,
    }),
  };
}

function missingPeriodMetrics(
  reason: string,
): Record<FinancialMetricConcept, FinancialMetricResult> {
  return Object.fromEntries(
    (Object.keys(METRIC_DEFINITIONS) as FinancialMetricConcept[]).map((concept) => [
      concept,
      metric(concept, missing(reason)),
    ]),
  ) as Record<FinancialMetricConcept, FinancialMetricResult>;
}

function standardized(
  value: StandardizedFinancialValue | undefined,
  fallbackReason: string,
): Operand {
  return value
    ? {
        value: value.value,
        inputVersions: value.inputVersions,
        ...(value.missingReason ? { missingReason: value.missingReason } : {}),
      }
    : missing(fallbackReason);
}

function balanceValue<Key extends keyof ResolvedBalanceSheet['values']>(
  balance: ResolvedBalanceSheet | null,
  field: Key,
  reason: string,
): Operand {
  if (!balance) {
    return missing('missing_balance_sheet');
  }
  const value = balance.values[field];
  return value == null
    ? { ...missing(reason), inputVersions: [balance.sourceRowFingerprint] }
    : { value, inputVersions: [balance.sourceRowFingerprint] };
}

function optionalBalanceValue<Key extends keyof ResolvedBalanceSheet['values']>(
  balance: ResolvedBalanceSheet | null,
  field: Key,
): Operand {
  if (!balance) {
    return missing('missing_balance_sheet');
  }
  return { value: balance.values[field] ?? 0, inputVersions: [balance.sourceRowFingerprint] };
}

function interestBearingDebt(balance: ResolvedBalanceSheet | null): Operand {
  if (!balance || balance.values.totalLiab == null) {
    return {
      ...missing(balance ? 'missing_total_liabilities' : 'missing_balance_sheet'),
      inputVersions: balance ? [balance.sourceRowFingerprint] : [],
    };
  }
  return {
    value:
      (balance.values.stBorr ?? 0) +
      (balance.values.nonCurLiabDue1y ?? 0) +
      (balance.values.ltBorr ?? 0) +
      (balance.values.bondPayable ?? 0),
    inputVersions: [balance.sourceRowFingerprint],
  };
}

function workingCapital(balance: ResolvedBalanceSheet | null): Operand {
  if (!balance) {
    return missing('missing_balance_sheet');
  }
  const currentAssets = balance.values.totalCurAssets;
  const currentLiabilities = balance.values.totalCurLiab;
  const cash = balance.values.moneyCap;
  if (currentAssets == null || currentLiabilities == null || cash == null) {
    return {
      value: null,
      inputVersions: [balance.sourceRowFingerprint],
      missingReason: 'missing_working_capital_inputs',
    };
  }
  const tradingAssets = balance.values.tradAsset ?? 0;
  const currentDebt = (balance.values.stBorr ?? 0) + (balance.values.nonCurLiabDue1y ?? 0);
  return {
    value: currentAssets - cash - tradingAssets - (currentLiabilities - currentDebt),
    inputVersions: [balance.sourceRowFingerprint],
  };
}

function investedCapital(balance: ResolvedBalanceSheet | null): Operand {
  if (!balance) {
    return missing('missing_balance_sheet');
  }
  const equity = balance.values.totalHldrEqyExcMinInt;
  const cash = balance.values.moneyCap;
  const debt = interestBearingDebt(balance);
  if (equity == null || cash == null || debt.value == null) {
    return {
      value: null,
      inputVersions: [balance.sourceRowFingerprint],
      missingReason: 'missing_invested_capital_inputs',
    };
  }
  return {
    value:
      equity +
      (balance.values.minorityInt ?? 0) +
      debt.value -
      cash -
      (balance.values.tradAsset ?? 0),
    inputVersions: [balance.sourceRowFingerprint],
  };
}

function mean(left: Operand, right: Operand): Operand {
  return combine([left, right], (leftValue, rightValue) => (leftValue + rightValue) / 2);
}

function divide(numerator: Operand, denominator: Operand): Operand {
  if (denominator.value === 0) {
    return {
      value: null,
      inputVersions: combinedVersions([numerator, denominator]),
      invalidReason: 'zero_denominator',
    };
  }
  return combine([numerator, denominator], (top, bottom) => top / bottom);
}

function divideDifference(current: Operand, previous: Operand): Operand {
  if (previous.value === 0) {
    return {
      value: null,
      inputVersions: combinedVersions([current, previous]),
      invalidReason: 'zero_prior_period_value',
    };
  }
  return combine(
    [current, previous],
    (currentValue, previousValue) => currentValue / previousValue - 1,
  );
}

function ratio(
  denominator: Operand,
  first: Operand,
  second: Operand,
  calculation: (first: number, second: number) => number,
): Operand {
  if (denominator.value === 0) {
    return {
      value: null,
      inputVersions: combinedVersions([first, second]),
      invalidReason: 'zero_denominator',
    };
  }
  return combine([first, second], calculation);
}

function cagr(current: Operand, previous: Operand, years: number): Operand {
  if (
    (current.value != null && current.value <= 0) ||
    (previous.value != null && previous.value <= 0)
  ) {
    return {
      value: null,
      inputVersions: combinedVersions([current, previous]),
      invalidReason: 'cagr_requires_positive_values',
    };
  }
  return combine(
    [current, previous],
    (currentValue, previousValue) => Math.pow(currentValue / previousValue, 1 / years) - 1,
  );
}

function combine(operands: Operand[], calculation: (...values: number[]) => number): Operand {
  const invalid = operands.find((operand) => operand.invalidReason);
  if (invalid) {
    return {
      value: null,
      inputVersions: combinedVersions(operands),
      invalidReason: invalid.invalidReason,
    };
  }
  const absent = operands.find((operand) => operand.value == null);
  if (absent) {
    return {
      value: null,
      inputVersions: combinedVersions(operands),
      missingReason: absent.missingReason ?? 'missing_input',
    };
  }
  const value = calculation(...operands.map((operand) => operand.value!));
  return Number.isFinite(value)
    ? { value, inputVersions: combinedVersions(operands) }
    : {
        value: null,
        inputVersions: combinedVersions(operands),
        invalidReason: 'non_finite_result',
      };
}

function missing(reason: string): Operand {
  return { value: null, inputVersions: [], missingReason: reason };
}

function combinedVersions(operands: Operand[]): string[] {
  return sortedUnique(operands.flatMap((operand) => operand.inputVersions));
}

function accountingDiagnostics(period: ResolvedFinancialPeriod): FinancialDiagnostic[] {
  const diagnostics: FinancialDiagnostic[] = [];
  const balance = period.balanceSheet?.values;
  if (
    balance?.totalAssets != null &&
    balance.totalLiab != null &&
    balance.totalHldrEqyExcMinInt != null
  ) {
    const represented =
      balance.totalLiab + balance.totalHldrEqyExcMinInt + (balance.minorityInt ?? 0);
    if (!withinTolerance(balance.totalAssets, represented)) {
      diagnostics.push({
        code: 'balance_sheet_identity_mismatch',
        severity: 'warning',
        message: `Assets differ from liabilities plus equity by ${balance.totalAssets - represented}.`,
        endDate: period.endDate,
        statementKind: 'balance_sheet',
      });
    }
  }

  const cashFlow = period.cashFlow?.values;
  if (
    cashFlow?.cCashEquBegPeriod != null &&
    cashFlow.nIncrCashCashEqu != null &&
    cashFlow.cCashEquEndPeriod != null &&
    !withinTolerance(
      cashFlow.cCashEquBegPeriod + cashFlow.nIncrCashCashEqu,
      cashFlow.cCashEquEndPeriod,
    )
  ) {
    diagnostics.push({
      code: 'cash_flow_identity_mismatch',
      severity: 'warning',
      message: 'Beginning cash plus net increase does not reconcile to ending cash.',
      endDate: period.endDate,
      statementKind: 'cash_flow',
    });
  }

  const incomeNetProfit = period.income?.values.nIncome;
  const cashFlowNetProfit = period.cashFlow?.values.netProfit;
  if (
    incomeNetProfit != null &&
    cashFlowNetProfit != null &&
    !withinTolerance(incomeNetProfit, cashFlowNetProfit)
  ) {
    diagnostics.push({
      code: 'cross_statement_net_income_mismatch',
      severity: 'warning',
      message: 'Income-statement net income does not match cash-flow reconciliation net profit.',
      endDate: period.endDate,
    });
  }
  return diagnostics;
}

function appendMetricDiagnostics(
  periods: FinancialPeriodMetrics[],
  diagnostics: FinancialDiagnostic[],
): void {
  for (const period of periods) {
    for (const metric of Object.values(period.metrics)) {
      if (metric.status === 'invalid') {
        diagnostics.push({
          code: 'invalid_financial_metric',
          severity: 'warning',
          message: `${metric.concept} is invalid: ${metric.missingReason ?? 'unknown reason'}.`,
          endDate: period.endDate,
          metric: metric.concept,
        });
      } else if (
        metric.status === 'ok' &&
        metric.unit === 'ratio' &&
        metric.value != null &&
        Math.abs(metric.value) > 10
      ) {
        diagnostics.push({
          code: 'extreme_financial_ratio',
          severity: 'warning',
          message: `${metric.concept} has an absolute value above 10.`,
          endDate: period.endDate,
          metric: metric.concept,
        });
      }
    }
  }
}

function baseResult(
  state: ResolvedFinancialState,
  periods: FinancialPeriodMetrics[],
  diagnostics: FinancialDiagnostic[],
): Omit<FinancialMetricsResult, 'resultFingerprint'> {
  return {
    formulaVersion: FINANCIAL_FORMULA_VERSION,
    resolverVersion: state.resolverVersion,
    tsCode: state.tsCode,
    asOfDate: state.asOfDate,
    periods,
    diagnostics,
  };
}

function fingerprintResult(result: Omit<FinancialMetricsResult, 'resultFingerprint'>): string {
  return createHash('sha256').update(JSON.stringify(result)).digest('hex');
}

function withinTolerance(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1, Math.max(Math.abs(left), Math.abs(right)) * 1e-6);
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
