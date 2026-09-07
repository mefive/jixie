import { describe, expect, it } from 'vitest';
import { auditValuationState } from './valuation-sample-audit.js';
import { calculateFinancialMetrics } from './metrics.js';
import type { ResolvedFinancialState } from './resolver.js';

describe('valuation sample audit', () => {
  it('does not count an empty history as a usable valuation or complete annual history', () => {
    const state = emptyState();
    expect(auditValuationState(state, calculateFinancialMetrics(state))).toMatchObject({
      periods: 0,
      completePeriods: 0,
      annualOperatingReady: false,
      latestBridgeReady: false,
      latestFcffReady: false,
      staleReport: true,
      consecutiveAnnualReports: 0,
      missing: { freeCashFlowToFirm: 'no_selected_period' },
    });
  });

  it('separates available negative cash flow, quarantined values, and stale reports', () => {
    const state = emptyState();
    state.periods = [{ endDate: '20241231', income: null, balanceSheet: null, cashFlow: null }];
    const calculated = calculateFinancialMetrics(state);
    const latest = calculated.periods[0];
    latest.metrics.freeCashFlowToFirm = {
      ...latest.metrics.freeCashFlowToFirm,
      status: 'ok',
      value: -20,
      missingReason: undefined,
    };
    expect(auditValuationState(state, calculated)).toMatchObject({
      latestFcffReady: true,
      completePeriods: 0,
      staleReport: true,
    });
    latest.metrics.freeCashFlowToFirm = {
      ...latest.metrics.freeCashFlowToFirm,
      status: 'invalid',
      value: -20,
      missingReason: 'accounting_review_required:negative_cash_capital_expenditure',
    };
    expect(auditValuationState(state, calculated)).toMatchObject({
      latestFcffReady: false,
      missing: {
        freeCashFlowToFirm: 'accounting_review_required:negative_cash_capital_expenditure',
      },
    });
  });

  it('does not use a valid older annual metric to hide an invalid latest annual metric', () => {
    const state = emptyState();
    state.periods = ['20231231', '20241231'].map((endDate) => ({
      endDate,
      income: null,
      balanceSheet: null,
      cashFlow: null,
    }));
    const calculated = calculateFinancialMetrics(state);
    for (const metric of ['revenue', 'nopat', 'nopatMargin', 'returnOnInvestedCapital'] as const) {
      calculated.periods[0].metrics[metric] = {
        ...calculated.periods[0].metrics[metric],
        status: 'ok',
        value: 1,
      };
    }
    expect(auditValuationState(state, calculated)).toMatchObject({
      annualReportPeriod: '20241231',
      annualOperatingReady: false,
    });
  });
});

function emptyState(): ResolvedFinancialState {
  return {
    resolverVersion: 1,
    tsCode: '000858.SZ',
    asOfDate: '20260907',
    strictPit: true,
    industry: null,
    applicability: 'unknown',
    periods: [],
    market: null,
    diagnostics: [],
  };
}
