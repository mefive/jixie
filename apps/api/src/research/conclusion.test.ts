import type {
  TimeSeriesRelationshipQuestionSpecV1,
  TimeSeriesRelationshipResultV1,
} from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { concludeTimeSeriesRelationship } from './conclusion.js';

const question: TimeSeriesRelationshipQuestionSpecV1 = {
  version: 1,
  kind: 'time_series_relationship',
  text: 'Does the predictor have a positive relationship with the outcome?',
  hypothesis: {
    estimand: 'regression_slope',
    direction: 'positive',
    nullValue: 0,
  },
};

describe('structured research conclusion', () => {
  it('supports a prespecified direction only when the interval, effect, and stability agree', () => {
    const conclusion = concludeTimeSeriesRelationship(
      question,
      relationshipResult({ pearson: 0.55, slope: 0.7, lower: 0.3, upper: 1.1 }),
      [],
    );

    expect(conclusion).toMatchObject({
      level: 'supports',
      direction: 'positive',
      effectSize: { magnitude: 'large' },
      stability: { assessment: 'stable' },
      rationaleCodes: ['interval_excludes_null', 'direction_matches', 'stable_rolling_effect'],
    });
  });

  it('does not turn an interval containing zero into near-support', () => {
    const conclusion = concludeTimeSeriesRelationship(
      question,
      relationshipResult({ pearson: 0.4, slope: 0.2, lower: -0.1, upper: 0.5 }),
      [],
    );

    expect(conclusion.level).toBe('does_not_support');
    expect(conclusion.rationaleCodes).toEqual(['confidence_interval_includes_null']);
  });

  it('reports weak support when the full-sample direction is unstable', () => {
    const result = relationshipResult({ pearson: 0.45, slope: 0.7, lower: 0.2, upper: 1.2 });
    result.rolling = result.rolling.map((point, index) => ({
      ...point,
      slope: index % 2 === 0 ? 0.4 : -0.4,
    }));
    const conclusion = concludeTimeSeriesRelationship(question, result, []);

    expect(conclusion.level).toBe('weak_support');
    expect(conclusion.stability.assessment).toBe('unstable');
    expect(conclusion.rationaleCodes).toContain('unstable_rolling_effect');
  });

  it('becomes indeterminate when a critical diagnostic fails', () => {
    const conclusion = concludeTimeSeriesRelationship(
      question,
      relationshipResult({ pearson: 0.55, slope: 0.7, lower: 0.3, upper: 1.1 }),
      [
        {
          code: 'low_series_variation',
          severity: 'error',
          messageZh: '序列缺少波动。',
          messageEn: 'A series lacks variation.',
        },
      ],
    );

    expect(conclusion.level).toBe('indeterminate');
    expect(conclusion.limitationsEn).toContain('A series lacks variation.');
  });
});

function relationshipResult(args: {
  pearson: number;
  slope: number;
  lower: number;
  upper: number;
}): TimeSeriesRelationshipResultV1 {
  return {
    kind: 'time_series_relationship',
    version: 1,
    observations: 60,
    pearson: args.pearson,
    spearman: args.pearson,
    regression: {
      intercept: 0,
      slope: args.slope,
      rSquared: 0.3,
      slopeStandardError: 0.1,
      slopeTStatistic: args.slope / 0.1,
      slopeConfidenceInterval95: { lower: args.lower, upper: args.upper },
      neweyWestLag: 3,
    },
    points: [],
    rolling: Array.from({ length: 12 }, (_, index) => ({
      date: `2024${String(index + 1).padStart(2, '0')}28`,
      observations: 24,
      pearson: args.pearson,
      spearman: args.pearson,
      slope: args.slope,
    })),
  };
}
