import {
  MARKET_RISK_FACTOR_KEYS_V1,
  type MarketRiskFactorKeyV1,
  type RiskDataLineageV1,
} from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { addDays } from '../lib/date.js';
import type { MarketRiskDriverHistoryV1 } from './market-risk-drivers.js';
import {
  alignPortfolioReturnsToNextSseSession,
  estimatePortfolioMarketRisk,
} from './market-risk-model.js';

const COEFFICIENTS: Record<MarketRiskFactorKeyV1, number> = {
  cn_equity: 0.7,
  cgb_level: -0.0004,
  cgb_slope: 0.0002,
  cgb_curvature: -0.0001,
  credit_spread: -0.0003,
  usd_cnh: -0.2,
  us_real_yield: -0.00015,
  gold: 0.15,
  commodity: 0.1,
};

describe('portfolio market-risk model', () => {
  it('recovers multivariate exposures and reconciles EWMA variance contributions', () => {
    const history = syntheticHistory(300);
    const portfolioReturns = history.observations.map((observation) => ({
      date: observation.date,
      return: MARKET_RISK_FACTOR_KEYS_V1.reduce(
        (sum, factor) => sum + observation.values[factor]! * COEFFICIENTS[factor],
        0,
      ),
    }));

    const report = estimatePortfolioMarketRisk(portfolioReturns, history, {
      asOfDate: '20251231',
    })!;

    expect(report).toMatchObject({
      version: 1,
      frequency: 'daily',
      methodology: 'rolling_multivariate_regression_ewma_covariance',
      observations: 252,
      covarianceHalfLife: 60,
    });
    expect(report.explainedVariance).toBeCloseTo(1, 10);
    for (const exposure of report.exposures) {
      expect(exposure.coefficient).toBeCloseTo(COEFFICIENTS[exposure.factor], 9);
    }
    expect(
      report.exposures.reduce(
        (sum, exposure) => sum + (exposure.varianceContributionShare ?? 0),
        0,
      ),
    ).toBeCloseTo(1, 10);
    expect(report.annualizedPortfolioVolatility).toBeGreaterThan(0);
  });

  it('returns unavailable when complete observations do not meet the frozen minimum', () => {
    const history = syntheticHistory(100);
    const portfolioReturns = history.observations.map((observation) => ({
      date: observation.date,
      return: 0.001,
    }));

    expect(
      estimatePortfolioMarketRisk(portfolioReturns, history, { asOfDate: '20251231' }),
    ).toBeNull();
  });

  it('drops incomplete driver dates instead of filling the missing factor with zero', () => {
    const history = syntheticHistory(130);
    delete history.observations[0]!.values.commodity;
    const portfolioReturns = history.observations.map((observation) => ({
      date: observation.date,
      return: MARKET_RISK_FACTOR_KEYS_V1.reduce(
        (sum, factor) => sum + (observation.values[factor] ?? 0) * COEFFICIENTS[factor],
        0,
      ),
    }));

    const report = estimatePortfolioMarketRisk(portfolioReturns, history, {
      asOfDate: '20251231',
      lookbackObservations: 130,
      minimumObservations: 120,
    });

    expect(report?.observations).toBe(129);
  });

  it('shifts portfolio close returns to the same strict next-session join key', () => {
    expect(
      alignPortfolioReturnsToNextSseSession(
        [
          { tradeDate: '20240105', return: 0.01 },
          { tradeDate: '20240108', return: -0.02 },
        ],
        ['20240105', '20240108', '20240109'],
      ),
    ).toEqual([
      { date: '20240108', return: 0.01 },
      { date: '20240109', return: -0.02 },
    ]);
  });

  it('freezes lineage at the requested as-of date even when the loaded history continues', () => {
    const history = syntheticHistory(300);
    const asOfDate = history.observations[199]!.date;
    const portfolioReturns = history.observations.map((observation) => ({
      date: observation.date,
      return: MARKET_RISK_FACTOR_KEYS_V1.reduce(
        (sum, factor) => sum + observation.values[factor]! * COEFFICIENTS[factor],
        0,
      ),
    }));

    const report = estimatePortfolioMarketRisk(portfolioReturns, history, {
      asOfDate,
      lookbackObservations: 150,
      minimumObservations: 120,
    });

    expect(report?.lineage.dataCutoff).toBe(asOfDate);
    expect(report?.lineage.series.every((series) => series.availableThrough <= asOfDate)).toBe(
      true,
    );
  });
});

function syntheticHistory(length: number): MarketRiskDriverHistoryV1 {
  const observations = Array.from({ length }, (_, index) => {
    const date = addDays('20230101', index);
    const values = Object.fromEntries(
      MARKET_RISK_FACTOR_KEYS_V1.map((factor, factorIndex) => {
        const scale = coefficientScale(factor);
        const value =
          scale *
          (Math.sin((index + 1) * (factorIndex + 1) * 0.071) +
            0.4 * Math.cos((index + 3) * (factorIndex + 2) * 0.037));
        return [factor, value];
      }),
    ) as Record<MarketRiskFactorKeyV1, number>;
    return { date, values };
  });
  const lineage: RiskDataLineageV1 = {
    dataCutoff: '20251231',
    pointInTimeEligible: true,
    futureVintageRows: 0,
    series: MARKET_RISK_FACTOR_KEYS_V1.map((seriesKey) => ({
      seriesKey,
      availableThrough: observations.at(-1)?.date ?? '20240101',
      revisionPolicy: 'not_revised',
    })),
  };
  return { version: 1, definitions: [], observations, lineage };
}

function coefficientScale(factor: MarketRiskFactorKeyV1): number {
  return ['cgb_level', 'cgb_slope', 'cgb_curvature', 'credit_spread', 'us_real_yield'].includes(
    factor,
  )
    ? 4
    : 0.015;
}
