import type { ResearchPlanSpecV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { executeResearchPlan } from './executor.js';
import { alignRelationshipPoints } from './time-series-relationship.js';
import {
  prepareResearchSeries,
  researchSeriesLoadStart,
  type ResearchSeriesLoader,
} from './series.js';

describe('research time-series preparation', () => {
  it('resamples to period-end before computing returns', () => {
    const points = prepareResearchSeries(
      [
        { date: '20240102', value: 100 },
        { date: '20240131', value: 110 },
        { date: '20240201', value: 121 },
        { date: '20240229', value: 132 },
      ],
      'monthly',
      'simple_return',
    );
    expect(points).toHaveLength(1);
    expect(points[0]!.date).toBe('20240229');
    expect(points[0]!.value).toBeCloseTo(0.2);
  });

  it('uses canonical calendar month ends so different market trading dates align', () => {
    const predictor = prepareResearchSeries(
      [
        { date: '20240130', value: 100 },
        { date: '20240228', value: 110 },
      ],
      'monthly',
      'level',
    );
    const outcome = prepareResearchSeries(
      [
        { date: '20240131', value: 200 },
        { date: '20240229', value: 220 },
      ],
      'monthly',
      'level',
    );

    expect(alignRelationshipPoints(predictor, outcome, 0)).toEqual([
      { date: '20240131', predictor: 100, outcome: 200 },
      { date: '20240229', predictor: 110, outcome: 220 },
    ]);
  });

  it('excludes an unfinished final month unless the plan explicitly includes it', () => {
    const raw = [
      { date: '20260731', value: 100 },
      { date: '20260813', value: 110 },
    ];
    const range = { start: '20260801', end: '20260813' };

    expect(
      prepareResearchSeries(raw, 'monthly', 'simple_return', {
        ...range,
        partialPeriod: 'exclude',
      }),
    ).toEqual([]);
    const included = prepareResearchSeries(raw, 'monthly', 'simple_return', {
      ...range,
      partialPeriod: 'include',
    });
    expect(included).toHaveLength(1);
    expect(included[0]!.date).toBe('20260831');
    expect(included[0]!.value).toBeCloseTo(0.1);
  });

  it('loads the prior comparison period needed for the first requested return', () => {
    expect(researchSeriesLoadStart('20260813', 'monthly', 'simple_return')).toBe('20260701');
    expect(researchSeriesLoadStart('20260813', 'monthly', 'year_over_year')).toBe('20250801');
    expect(researchSeriesLoadStart('20260813', 'monthly', 'level')).toBe('20260813');
  });

  it('computes year-over-year values by calendar month rather than row offset', () => {
    const points = prepareResearchSeries(
      [
        { date: '20230131', value: 100 },
        { date: '20230228', value: 120 },
        { date: '20240131', value: 110 },
        { date: '20240229', value: 150 },
      ],
      'monthly',
      'year_over_year',
    );
    expect(points[0]!.value).toBeCloseTo(10);
    expect(points[1]!.value).toBeCloseTo(25);
  });

  it('applies predictor lag only after deterministic date alignment', () => {
    expect(
      alignRelationshipPoints(
        [
          { date: '20240131', value: 1 },
          { date: '20240229', value: 2 },
          { date: '20240331', value: 3 },
        ],
        [
          { date: '20240131', value: 10 },
          { date: '20240229', value: 20 },
          { date: '20240331', value: 30 },
        ],
        1,
      ),
    ).toEqual([
      { date: '20240229', predictor: 1, outcome: 20 },
      { date: '20240331', predictor: 2, outcome: 30 },
    ]);
  });
});

describe('executeResearchPlan', () => {
  it('runs the registered relationship protocol without generated SQL or code', async () => {
    const plan = relationshipPlan();
    const loadSeries: ResearchSeriesLoader = async (input) => ({
      points: Array.from({ length: 60 }, (_, index) => {
        const year = 2020 + Math.floor(index / 12);
        const month = String((index % 12) + 1).padStart(2, '0');
        const predictor = index + Math.sin(index / 3);
        return {
          date: `${year}${month}28`,
          value: input.id === 'predictor' ? predictor : 2 * predictor + (index % 3) * 0.1,
        };
      }),
      diagnostics: [],
    });

    const run = await executeResearchPlan(plan, { loadSeries });

    expect(run.result.observations).toBe(60);
    expect(run.result.pearson).toBeGreaterThan(0.99);
    expect(run.result.regression.slope).toBeCloseTo(2, 1);
    expect(run.result.regression.neweyWestLag).toBeGreaterThanOrEqual(0);
    expect(run.result.rolling).toHaveLength(37);
    expect(run.conclusion).toMatchObject({
      level: 'supports',
      direction: 'positive',
      intervalExcludesNull: true,
      hypothesisDirectionMatches: true,
      stability: { assessment: 'stable', windows: 37 },
    });
    expect(run.conclusion.summaryZh).toContain('样本支持正向关系');
    expect(run.conclusion.limitationsEn).toContain(
      'An observed relationship is not causal evidence or proof of tradable predictability.',
    );
    expect(run.protocol.formulae).toHaveLength(2);
    expect(run.protocol.pythonExample).toContain('statsmodels');
    expect(run.coverage.every((item) => item.observationsAligned === 60)).toBe(true);
  });

  it('rejects a sample below the protocol minimum', async () => {
    const loadSeries: ResearchSeriesLoader = async () => ({
      points: Array.from({ length: 10 }, (_, index) => ({
        date: `2024${String(index + 1).padStart(2, '0')}28`,
        value: index + 1,
      })),
      diagnostics: [],
    });
    await expect(executeResearchPlan(relationshipPlan(), { loadSeries })).rejects.toThrow(
      'requires at least 24 aligned observations',
    );
  });
});

function relationshipPlan(): ResearchPlanSpecV1 {
  return {
    version: 1,
    question: {
      version: 1,
      kind: 'time_series_relationship',
      text: '两个序列的月度变化是否正相关？',
      hypothesis: {
        estimand: 'regression_slope',
        direction: 'positive',
        nullValue: 0,
      },
    },
    start: '20200101',
    end: '20251231',
    inputs: [
      {
        type: 'series',
        id: 'predictor',
        source: { kind: 'instrument', assetType: 'index', id: '000300.SH' },
        measure: 'market.adjusted_close',
        transform: 'level',
      },
      {
        type: 'series',
        id: 'outcome',
        source: { kind: 'instrument', assetType: 'index', id: '000905.SH' },
        measure: 'market.adjusted_close',
        transform: 'level',
      },
    ],
    alignment: { frequency: 'monthly', join: 'inner', partialPeriod: 'exclude' },
    protocol: {
      kind: 'time_series_relationship',
      version: 1,
      predictor: 'predictor',
      outcome: 'outcome',
      predictorLag: 0,
      correlations: ['pearson', 'spearman'],
      inference: { kind: 'newey_west', lag: 'automatic' },
      rollingWindow: 24,
    },
    outputs: [
      { kind: 'summary_table' },
      { kind: 'scatter' },
      { kind: 'rolling_relationship' },
      { kind: 'conclusion' },
      { kind: 'formula' },
      { kind: 'python_example' },
      { kind: 'documentation' },
    ],
  };
}
