import {
  MARKET_RISK_FACTOR_KEYS_V1,
  type AlphaRiskOverlapV1,
  type FactorResearchReportPayloadV1,
  type MarketRiskFactorKeyV1,
} from '@jixie/shared';
import type { MarketRiskDriverHistoryV1 } from './market-risk-drivers.js';

export const ALPHA_RISK_OVERLAP_MINIMUM_OBSERVATIONS = 24;
export const ALPHA_RISK_OVERLAP_MATERIAL_CORRELATION = 0.2;
export const ALPHA_RISK_OVERLAP_DOMINANT_CORRELATION = 0.5;

const BASIS_POINT_FACTORS = new Set<MarketRiskFactorKeyV1>([
  'cgb_level',
  'cgb_slope',
  'cgb_curvature',
  'credit_spread',
  'us_real_yield',
]);

export interface AlphaPeriodReturnObservation {
  /** Both boundaries use the same availability-aligned SSE key as MarketRiskDriverHistoryV1. */
  startDate: string;
  endDate: string;
  return: number;
}

export interface RawAlphaPeriodReturnObservation {
  formationDate: string;
  periodEndDate: string;
  return: number;
}

export interface AnalyzeAlphaRiskOverlapOptions {
  minimumObservations?: number;
  alphaReturnKind?: AlphaRiskOverlapV1['alphaReturnKind'];
}

/** Maps close-to-close Alpha periods onto strict next-SSE availability boundaries. */
export function alignAlphaPeriodReturnsToRiskAvailability(
  rows: RawAlphaPeriodReturnObservation[],
  openDates: string[],
): AlphaPeriodReturnObservation[] {
  const sessions = [...new Set(openDates)].sort();
  if (sessions.some((date) => !/^\d{8}$/.test(date))) {
    throw new Error('Alpha-risk availability calendar contains an invalid date.');
  }
  return rows.map((row) => {
    validateRawPeriod(row);
    const startDate = sessions.find((date) => date > row.formationDate);
    const endDate = sessions.find((date) => date > row.periodEndDate);
    if (!startDate || !endDate) {
      throw new Error(
        `Alpha period ${row.formationDate}..${row.periodEndDate} lacks a next SSE session.`,
      );
    }
    return { startDate, endDate, return: row.return };
  });
}

/** Extracts the frozen net long-short evidence already persisted by cross-sectional and Panel Alpha reports. */
export function alphaPeriodsFromFactorReport(
  payload: FactorResearchReportPayloadV1,
): RawAlphaPeriodReturnObservation[] {
  switch (payload.analysisKind) {
    case 'cross_sectional':
      return (payload.report.periodObservations ?? []).map((period) => ({
        formationDate: period.formationDate,
        periodEndDate: period.periodEndDate,
        return: period.longShortNetReturn,
      }));
    case 'panel':
      return payload.report.periodReports.map((period) => ({
        formationDate: period.asOfDate,
        periodEndDate: period.targetDate,
        return: period.longShortNetReturn,
      }));
    case 'time_series':
    case 'macro_regime':
      return [];
  }
}

/** Correlates an Alpha return stream with exactly aligned market-driver changes, one factor at a time. */
export function analyzeAlphaRiskOverlap(
  alphaFactorKey: string,
  alphaPeriods: AlphaPeriodReturnObservation[],
  driverHistory: MarketRiskDriverHistoryV1,
  options: AnalyzeAlphaRiskOverlapOptions = {},
): AlphaRiskOverlapV1[] {
  const minimumObservations =
    options.minimumObservations ?? ALPHA_RISK_OVERLAP_MINIMUM_OBSERVATIONS;
  if (!alphaFactorKey.trim() || !Number.isInteger(minimumObservations) || minimumObservations < 3) {
    throw new Error('Alpha-risk overlap requires a factor key and at least three observations.');
  }
  const periods = validateAlignedPeriods(alphaPeriods);
  if (!driverHistory.lineage.pointInTimeEligible || driverHistory.lineage.futureVintageRows !== 0) {
    return [];
  }

  return MARKET_RISK_FACTOR_KEYS_V1.flatMap((marketFactor) => {
    const pairs = periods.flatMap((period) => {
      const marketReturn = aggregateMarketFactor(driverHistory, marketFactor, period);
      return marketReturn == null ? [] : [{ alpha: period.return, market: marketReturn }];
    });
    if (pairs.length < minimumObservations) {
      return [];
    }
    const correlation = pearson(
      pairs.map((pair) => pair.alpha),
      pairs.map((pair) => pair.market),
    );
    if (correlation == null) {
      return [];
    }
    return [
      {
        alphaFactorKey,
        alphaReturnKind: options.alphaReturnKind ?? 'net_long_short',
        marketFactor,
        observations: pairs.length,
        correlation,
        classification: classifyAlphaRiskOverlap(correlation),
      } satisfies AlphaRiskOverlapV1,
    ];
  });
}

export function classifyAlphaRiskOverlap(
  correlation: number,
): AlphaRiskOverlapV1['classification'] {
  if (!Number.isFinite(correlation) || Math.abs(correlation) > 1 + Number.EPSILON) {
    throw new Error('Alpha-risk overlap correlation must be finite and between -1 and 1.');
  }
  const absoluteCorrelation = Math.abs(correlation);
  if (absoluteCorrelation >= ALPHA_RISK_OVERLAP_DOMINANT_CORRELATION) {
    return 'dominant';
  }
  if (absoluteCorrelation >= ALPHA_RISK_OVERLAP_MATERIAL_CORRELATION) {
    return 'material';
  }
  return 'low';
}

function aggregateMarketFactor(
  history: MarketRiskDriverHistoryV1,
  factor: MarketRiskFactorKeyV1,
  period: AlphaPeriodReturnObservation,
): number | null {
  const values = history.observations
    .filter(
      (observation) => observation.date > period.startDate && observation.date <= period.endDate,
    )
    .flatMap((observation) => {
      const value = observation.values[factor];
      return value == null || !Number.isFinite(value) ? [] : [value];
    });
  if (values.length === 0) {
    return null;
  }
  return BASIS_POINT_FACTORS.has(factor)
    ? values.reduce((sum, value) => sum + value, 0)
    : values.reduce((wealth, value) => wealth * (1 + value), 1) - 1;
}

function validateAlignedPeriods(
  periods: AlphaPeriodReturnObservation[],
): AlphaPeriodReturnObservation[] {
  const keys = new Set<string>();
  return [...periods]
    .sort((left, right) => left.endDate.localeCompare(right.endDate))
    .map((period) => {
      if (
        !/^\d{8}$/.test(period.startDate) ||
        !/^\d{8}$/.test(period.endDate) ||
        period.startDate >= period.endDate ||
        !Number.isFinite(period.return)
      ) {
        throw new Error(`Invalid availability-aligned Alpha period ${period.startDate}.`);
      }
      const key = `${period.startDate}|${period.endDate}`;
      if (keys.has(key)) {
        throw new Error(`Duplicate availability-aligned Alpha period ${key}.`);
      }
      keys.add(key);
      return period;
    });
}

function validateRawPeriod(period: RawAlphaPeriodReturnObservation): void {
  if (
    !/^\d{8}$/.test(period.formationDate) ||
    !/^\d{8}$/.test(period.periodEndDate) ||
    period.formationDate >= period.periodEndDate ||
    !Number.isFinite(period.return)
  ) {
    throw new Error(`Invalid raw Alpha period ${period.formationDate}.`);
  }
}

function pearson(left: number[], right: number[]): number | null {
  const leftMean = mean(left);
  const rightMean = mean(right);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index++) {
    const leftCentered = left[index]! - leftMean;
    const rightCentered = right[index]! - rightMean;
    covariance += leftCentered * rightCentered;
    leftVariance += leftCentered ** 2;
    rightVariance += rightCentered ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > Number.EPSILON ? covariance / denominator : null;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
