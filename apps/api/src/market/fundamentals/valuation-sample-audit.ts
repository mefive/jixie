import type { FinancialMetricsResult } from './metrics.js';
import type { ResolvedFinancialState } from './resolver.js';

export const VALUATION_AUDIT_METRICS = [
  'revenue',
  'nopat',
  'nopatMargin',
  'returnOnInvestedCapital',
  'operatingCashFlow',
  'reinvestment',
  'freeCashFlowToFirm',
  'marketCapitalization',
  'enterpriseValue',
  'issuedShares',
] as const;

export function auditValuationState(
  state: ResolvedFinancialState,
  calculated: FinancialMetricsResult,
) {
  const latest = calculated.periods.at(-1);
  const annual = calculated.periods.filter((period) => period.endDate.endsWith('1231')).at(-1);
  const operating = ['revenue', 'nopat', 'nopatMargin', 'returnOnInvestedCapital'] as const;
  const bridge = ['marketCapitalization', 'enterpriseValue', 'issuedShares'] as const;
  const usable = (metric: { status: string; value: number | null } | undefined) =>
    metric?.status === 'ok' && metric.value != null && Number.isFinite(metric.value);
  const completePeriods = state.periods.filter(
    (period) => period.income && period.balanceSheet && period.cashFlow,
  );
  const completeDates = new Set(completePeriods.map((period) => period.endDate));
  let consecutiveAnnualReports = 0;
  if (annual) {
    for (let year = Number(annual.endDate.slice(0, 4)); completeDates.has(`${year}1231`); year--) {
      consecutiveAnnualReports++;
    }
  }
  const missing = Object.fromEntries(
    VALUATION_AUDIT_METRICS.map((name) => {
      const metric = latest?.metrics[name];
      return [
        name,
        usable(metric) ? null : (metric?.missingReason ?? metric?.status ?? 'no_selected_period'),
      ];
    }),
  );
  const reportAgeDays = latest
    ? Math.round(
        (Date.parse(isoDate(state.asOfDate)) - Date.parse(isoDate(latest.endDate))) / 86_400_000,
      )
    : null;
  return {
    code: state.tsCode,
    applicability: state.applicability,
    industryKnown: state.industry != null,
    periods: state.periods.length,
    completePeriods: completePeriods.length,
    consecutiveAnnualReports,
    latestReportPeriod: latest?.endDate ?? null,
    annualReportPeriod: annual?.endDate ?? null,
    reportAgeDays,
    staleReport: reportAgeDays == null || reportAgeDays > 180,
    marketDate: state.market?.tradeDate ?? null,
    annualOperatingReady: operating.every((name) => usable(annual?.metrics[name])),
    latestBridgeReady: bridge.every((name) => usable(latest?.metrics[name])),
    latestFcffReady: usable(latest?.metrics.freeCashFlowToFirm),
    annualFcffReady: usable(annual?.metrics.freeCashFlowToFirm),
    annualFcffMissingReason: usable(annual?.metrics.freeCashFlowToFirm)
      ? null
      : (annual?.metrics.freeCashFlowToFirm.missingReason ?? 'no_annual_period'),
    missing,
    diagnostics: [...new Set(calculated.diagnostics.map((diagnostic) => diagnostic.code))],
  };
}

export function isoDate(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}
