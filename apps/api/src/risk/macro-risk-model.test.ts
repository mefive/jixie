import {
  MACRO_RISK_AXIS_KEYS_V1,
  type MacroRiskAxisKeyV1,
  type RiskDataLineageV1,
} from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import type { MacroRiskAxisHistoryV1 } from './macro-risk-axes.js';
import {
  aggregatePortfolioMonthlyReturns,
  estimatePortfolioMacroRisk,
} from './macro-risk-model.js';

const COEFFICIENTS: Record<MacroRiskAxisKeyV1, number> = {
  growth: 0.012,
  inflation: -0.008,
  liquidity: 0.009,
  credit: 0.006,
  external: -0.011,
};

describe('portfolio macro-risk model', () => {
  it('recovers five monthly sensitivities and reports Newey-West inference', () => {
    const history = syntheticHistory(100, true);
    const portfolioReturns = history.observations.map((observation, index) => ({
      date: observation.date,
      return:
        MACRO_RISK_AXIS_KEYS_V1.reduce(
          (sum, axis) => sum + observation.values[axis]! * COEFFICIENTS[axis],
          0,
        ) +
        0.0002 * Math.sin(index * 1.71),
    }));

    const report = estimatePortfolioMacroRisk(portfolioReturns, history, {
      asOfDate: '20301231',
    })!;

    expect(report).toMatchObject({
      version: 1,
      frequency: 'monthly',
      methodology: 'monthly_multivariate_regression_newey_west',
      observations: 60,
      pointInTimeEligible: true,
    });
    expect(report.neweyWestLag).toBeGreaterThan(0);
    for (const sensitivity of report.sensitivities) {
      expect(sensitivity.coefficient).toBeCloseTo(COEFFICIENTS[sensitivity.axis], 3);
      expect(Number.isFinite(sensitivity.neweyWestTStat)).toBe(true);
    }
  });

  it('allows latest-vintage exploration but never labels it point-in-time eligible', () => {
    const history = syntheticHistory(60, false);
    const returns = history.observations.map((observation, index) => ({
      date: observation.date,
      return:
        MACRO_RISK_AXIS_KEYS_V1.reduce(
          (sum, axis) => sum + observation.values[axis]! * COEFFICIENTS[axis],
          0,
        ) +
        0.0002 * Math.cos(index * 1.43),
    }));

    const report = estimatePortfolioMacroRisk(returns, history, {
      asOfDate: '20301231',
      neweyWestLag: 2,
    });

    expect(report?.pointInTimeEligible).toBe(false);
    expect(report?.lineage).toMatchObject({
      pointInTimeEligible: false,
      futureVintageRows: 8,
    });
  });

  it('drops incomplete months and returns unavailable below the frozen minimum', () => {
    const history = syntheticHistory(36, true);
    delete history.observations[0]!.values.credit;
    const returns = history.observations.map((observation) => ({
      date: observation.date,
      return: 0.01,
    }));

    expect(estimatePortfolioMacroRisk(returns, history, { asOfDate: '20301231' })).toBeNull();
  });

  it('freezes raw-series lineage at the report as-of month', () => {
    const history = syntheticHistory(80, true);
    const asOfDate = history.observations[59]!.date;
    const returns = history.observations.map((observation, index) => ({
      date: observation.date,
      return:
        MACRO_RISK_AXIS_KEYS_V1.reduce(
          (sum, axis) => sum + observation.values[axis]! * COEFFICIENTS[axis],
          0,
        ) +
        0.0002 * Math.sin(index * 1.37),
    }));

    const report = estimatePortfolioMacroRisk(returns, history, {
      asOfDate,
      lookbackObservations: 48,
      minimumObservations: 36,
    });

    expect(report?.lineage.dataCutoff).toBe(asOfDate);
    expect(report?.lineage.series.every((series) => series.availableThrough <= asOfDate)).toBe(
      true,
    );
  });

  it('compounds daily returns and keys each month to its final observation', () => {
    expect(
      aggregatePortfolioMonthlyReturns([
        { date: '20240102', return: 0.1 },
        { date: '20240131', return: -0.05 },
        { date: '20240201', return: 0.02 },
      ]),
    ).toEqual([
      { date: '20240131', return: 0.04499999999999993 },
      { date: '20240201', return: 0.020000000000000018 },
    ]);
  });
});

function syntheticHistory(length: number, pointInTimeEligible: boolean): MacroRiskAxisHistoryV1 {
  const dates = Array.from({ length }, (_, index) => `${addMonths('202001', index)}28`);
  const observations = dates.map((date, index) => ({
    date,
    values: Object.fromEntries(
      MACRO_RISK_AXIS_KEYS_V1.map((axis, axisIndex) => [
        axis,
        Math.sin((index + 1) * (axisIndex + 2) * 0.19) +
          0.4 * Math.cos((index + 3) * (axisIndex + 1) * 0.11),
      ]),
    ) as Record<MacroRiskAxisKeyV1, number>,
  }));
  const lineage: RiskDataLineageV1 = {
    dataCutoff: dates.at(-1)!,
    pointInTimeEligible,
    futureVintageRows: pointInTimeEligible ? 0 : 8,
    series: [
      {
        seriesKey: 'macro',
        availableThrough: dates.at(-1)!,
        revisionPolicy: pointInTimeEligible ? 'as_available' : 'latest_vintage',
      },
      {
        seriesKey: 'external',
        availableThrough: dates.at(-1)!,
        revisionPolicy: 'not_revised',
      },
    ],
  };
  return {
    version: 1,
    definitions: [],
    revisionPolicy: pointInTimeEligible ? 'as_available' : 'latest_vintage',
    states: dates.map((date) => ({
      month: date.slice(0, 6),
      date,
      values: observations.find((observation) => observation.date === date)!.values,
      latestAvailableDates: {},
      seriesAvailableThrough: { macro: date, external: date },
      pointInTimeEligible,
      futureVintageRows: pointInTimeEligible ? 0 : 8,
    })),
    observations,
    skippedDates: [],
    lineage,
  };
}

function addMonths(month: string, months: number): string {
  const date = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(4, 6)) - 1 + months),
  );
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
