import type {
  MultivariateTimeSeriesProtocolSpecV1,
  MultivariateTimeSeriesQuestionSpecV1,
} from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { linearRegression } from '../lib/stats.js';
import { concludeMultivariateTimeSeriesRelationship } from './multivariate-conclusion.js';
import {
  alignMultivariatePoints,
  evaluateMultivariateTimeSeriesRelationship,
} from './multivariate-time-series.js';

const protocol: MultivariateTimeSeriesProtocolSpecV1 = {
  kind: 'multivariate_time_series_relationship',
  version: 1,
  outcome: 'outcome',
  predictors: [
    { input: 'focal', role: 'focal', lag: 1 },
    { input: 'control', role: 'control', lag: 0 },
  ],
  inference: { kind: 'newey_west', lag: 2 },
  rollingWindow: 36,
};

describe('multivariate time-series relationship', () => {
  it('aligns every series on common dates and applies predictor-specific lags', () => {
    const points = alignMultivariatePoints(
      protocol,
      new Map([
        ['outcome', series([10, 20, 30, 40])],
        ['focal', series([1, 2, 3, 4])],
        ['control', series([5, 6, 7, 8])],
      ]),
    );

    expect(points).toEqual([
      {
        date: '20200201',
        outcome: 20,
        predictors: { focal: 1, control: 6 },
      },
      {
        date: '20200301',
        outcome: 30,
        predictors: { focal: 2, control: 7 },
      },
      {
        date: '20200401',
        outcome: 40,
        predictors: { focal: 3, control: 8 },
      },
    ]);
  });

  it('recovers partial coefficients and publishes collinearity and rolling evidence', () => {
    const observations = 90;
    const focal = Array.from(
      { length: observations },
      (_, index) => Math.sin(index / 4) + index * 0.015,
    );
    const control = Array.from(
      { length: observations },
      (_, index) => Math.cos(index / 6) - index * 0.008,
    );
    const outcome = focal.map(
      (value, index) => 1.25 + 2.4 * value - 1.1 * control[index]! + Math.sin(index * 1.7) * 0.035,
    );
    const evaluation = evaluateMultivariateTimeSeriesRelationship(
      { ...protocol, predictors: protocol.predictors.map((item) => ({ ...item, lag: 0 })) },
      new Map([
        ['outcome', series(outcome)],
        ['focal', series(focal)],
        ['control', series(control)],
      ]),
      36,
    );

    expect(evaluation.result.observations).toBe(observations);
    expect(evaluation.result.rSquared).toBeGreaterThan(0.99);
    expect(evaluation.result.coefficients).toHaveLength(2);
    expect(evaluation.result.coefficients[0]).toMatchObject({
      inputId: 'focal',
      role: 'focal',
    });
    expect(evaluation.result.coefficients[0]!.estimate).toBeCloseTo(2.4, 1);
    expect(evaluation.result.coefficients[1]!.estimate).toBeCloseTo(-1.1, 1);
    expect(evaluation.result.coefficients[0]!.partialRSquared).toBeGreaterThan(0.9);
    expect(evaluation.result.predictorCorrelations).toHaveLength(4);
    expect(evaluation.result.partialRegression).toHaveLength(observations);
    expect(
      linearRegression(
        evaluation.result.partialRegression.map((point) => point.focalResidual),
        evaluation.result.partialRegression.map((point) => point.outcomeResidual),
      ).slope,
    ).toBeCloseTo(evaluation.result.coefficients[0]!.estimate, 10);
    expect(evaluation.result.rolling.length).toBe(observations - 36 + 1);
    expect(evaluation.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'multivariate_association_not_causation' }),
    );
  });

  it('bases the conclusion only on the prespecified focal predictor', () => {
    const observations = 72;
    const focal = Array.from({ length: observations }, (_, index) => Math.sin(index / 3));
    const control = Array.from({ length: observations }, (_, index) => Math.cos(index / 5));
    const outcome = focal.map(
      (value, index) => 0.8 * value + 1.7 * control[index]! + Math.sin(index * 2.1) * 0.05,
    );
    const evaluation = evaluateMultivariateTimeSeriesRelationship(
      { ...protocol, predictors: protocol.predictors.map((item) => ({ ...item, lag: 0 })) },
      new Map([
        ['outcome', series(outcome)],
        ['focal', series(focal)],
        ['control', series(control)],
      ]),
      36,
    );
    const question: MultivariateTimeSeriesQuestionSpecV1 = {
      version: 1,
      kind: 'multivariate_time_series_relationship',
      text: 'Is focal positively related to outcome after controlling for control?',
      hypothesis: {
        estimand: 'partial_regression_coefficient',
        focalPredictor: 'focal',
        direction: 'positive',
        nullValue: 0,
      },
    };

    const conclusion = concludeMultivariateTimeSeriesRelationship(
      question,
      evaluation.result,
      evaluation.diagnostics,
    );
    expect(conclusion.focalPredictor).toBe('focal');
    expect(conclusion.direction).toBe('positive');
    expect(conclusion.intervalExcludesNull).toBe(true);
    expect(conclusion.effectSize.metric).toBe('partial_r_squared');
    expect(conclusion.summaryEn).toContain('After controlling');
  });

  it('warns on severe collinearity and refuses an exactly singular design', () => {
    const observations = 72;
    const focal = Array.from({ length: observations }, (_, index) => Math.sin(index / 4));
    const almostDuplicate = focal.map(
      (value, index) => value * 0.999 + Math.cos(index / 7) * 0.001,
    );
    const outcome = focal.map(
      (value, index) => value * 0.7 + almostDuplicate[index]! * 0.2 + Math.sin(index) * 0.02,
    );
    const noLag = {
      ...protocol,
      predictors: protocol.predictors.map((item) => ({ ...item, lag: 0 })),
    };
    const evaluation = evaluateMultivariateTimeSeriesRelationship(
      noLag,
      new Map([
        ['outcome', series(outcome)],
        ['focal', series(focal)],
        ['control', series(almostDuplicate)],
      ]),
      36,
    );
    expect(evaluation.result.coefficients[0]!.varianceInflationFactor).toBeGreaterThan(5);
    expect(evaluation.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'multivariate_high_vif', severity: 'warning' }),
    );

    expect(() =>
      evaluateMultivariateTimeSeriesRelationship(
        noLag,
        new Map([
          ['outcome', series(outcome)],
          ['focal', series(focal)],
          ['control', series(focal)],
        ]),
        36,
      ),
    ).toThrow('regression is singular');
  });
});

function series(values: number[]) {
  return values.map((value, index) => ({
    date: `2020${String(index + 1).padStart(2, '0')}01`,
    value,
  }));
}
