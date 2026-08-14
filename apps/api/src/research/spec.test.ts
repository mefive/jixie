import type { TimeSeriesRelationshipPlanSpecV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { parseResearchPlanSpec, validateResearchPlanSemantics } from './spec.js';

function validPlan() {
  return {
    version: 1,
    question: {
      version: 1,
      kind: 'time_series_relationship',
      text: '沪深300和中证500的月收益是否正相关？',
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
        id: 'csi300',
        source: { kind: 'instrument', assetType: 'index', id: '000300.SH' },
        measure: 'market.adjusted_close',
        transform: 'simple_return',
      },
      {
        type: 'series',
        id: 'csi500',
        source: { kind: 'instrument', assetType: 'index', id: '000905.SH' },
        measure: 'market.adjusted_close',
        transform: 'simple_return',
      },
    ],
    alignment: { frequency: 'monthly', join: 'inner', partialPeriod: 'exclude' },
    protocol: {
      kind: 'time_series_relationship',
      version: 1,
      predictor: 'csi300',
      outcome: 'csi500',
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

describe('ResearchPlanSpec V1', () => {
  it('accepts a registered, structured time-series relationship plan', () => {
    expect(parseResearchPlanSpec(validPlan())).toMatchObject({
      version: 1,
      protocol: { kind: 'time_series_relationship' },
    });
  });

  it('accepts a multivariate plan with one focal predictor and prespecified controls', () => {
    const plan = validPlan();
    plan.question = {
      version: 1,
      kind: 'multivariate_time_series_relationship',
      text: '实际利率变化在控制通胀后是否与黄金月收益负相关？',
      hypothesis: {
        estimand: 'partial_regression_coefficient',
        focalPredictor: 'realYield',
        direction: 'negative',
        nullValue: 0,
      },
    } as never;
    plan.inputs = [
      {
        type: 'series',
        id: 'gold',
        source: { kind: 'instrument', assetType: 'future', id: 'AU.SHF' },
        measure: 'market.adjusted_close',
        transform: 'simple_return',
      },
      {
        type: 'series',
        id: 'realYield',
        source: {
          kind: 'yield_curve',
          curveCode: 'us_treasury_real',
          curveType: 'par',
          termYears: 10,
        },
        measure: 'rates.yield_pct',
        transform: 'difference',
      },
      {
        type: 'series',
        id: 'headlineCpi',
        source: { kind: 'macro', seriesKey: 'us_cpi_u_all_items_nsa' },
        measure: 'macro.observation',
        transform: 'year_over_year',
      },
    ] as never;
    plan.protocol = {
      kind: 'multivariate_time_series_relationship',
      version: 1,
      outcome: 'gold',
      predictors: [
        { input: 'realYield', role: 'focal', lag: 0 },
        { input: 'headlineCpi', role: 'control', lag: 0 },
      ],
      inference: { kind: 'newey_west', lag: 'automatic' },
      rollingWindow: 36,
    } as never;
    plan.outputs = [
      { kind: 'summary_table' },
      { kind: 'coefficient_plot' },
      { kind: 'partial_regression' },
      { kind: 'correlation_matrix' },
      { kind: 'rolling_coefficients' },
      { kind: 'conclusion' },
      { kind: 'formula' },
      { kind: 'python_example' },
      { kind: 'documentation' },
    ] as never;

    expect(parseResearchPlanSpec(plan)).toMatchObject({
      protocol: {
        kind: 'multivariate_time_series_relationship',
        outcome: 'gold',
      },
    });

    const invalid = structuredClone(plan) as unknown as {
      protocol: { predictors: Array<{ role: string }> };
    };
    invalid.protocol.predictors[1].role = 'focal';
    expect(() => parseResearchPlanSpec(invalid)).toThrow(
      'protocol must define exactly one focal predictor',
    );
  });

  it('rejects arbitrary SQL and execution code fields', () => {
    const plan = validPlan() as ReturnType<typeof validPlan> & {
      sql?: string;
      code?: string;
    };
    plan.sql = 'SELECT * FROM Daily';
    plan.code = 'export default () => 1';
    expect(() => parseResearchPlanSpec(plan)).toThrow();
  });

  it('rejects an unregistered measure instead of guessing a table or column', () => {
    const plan = validPlan();
    plan.inputs[0]!.measure = 'Daily.close';
    expect(() => parseResearchPlanSpec(plan)).toThrow('unknown measure Daily.close');
  });

  it('rejects source and measure combinations with different semantics', () => {
    const plan = validPlan();
    plan.inputs[0]!.source = { kind: 'macro', seriesKey: 'cn_cpi_yoy' } as never;
    expect(() => parseResearchPlanSpec(plan)).toThrow(
      'market.adjusted_close does not support source macro',
    );
  });

  it('rejects duplicate ids, outputs, and invalid protocol references', () => {
    const plan = parseResearchPlanSpec(validPlan()) as TimeSeriesRelationshipPlanSpecV1;
    plan.inputs[1]!.id = plan.inputs[0]!.id;
    plan.protocol.outcome = 'missing';
    plan.outputs[1] = plan.outputs[0]!;
    expect(validateResearchPlanSemantics(plan)).toEqual(
      expect.arrayContaining([
        'duplicate input id csi300',
        'unknown outcome input missing',
        'outputs must not contain duplicates',
      ]),
    );
  });

  it('requires a protocol-matched falsifiable question and structured conclusion output', () => {
    const plan = validPlan();
    plan.question.kind = 'event_study' as never;
    expect(() => parseResearchPlanSpec(plan)).toThrow();

    const missingConclusion = validPlan();
    missingConclusion.outputs = missingConclusion.outputs.filter(
      (output) => output.kind !== 'conclusion',
    );
    expect(() => parseResearchPlanSpec(missingConclusion)).toThrow(
      'outputs must include conclusion',
    );
  });

  it('keeps UniverseSpec out of a protocol that does not consume an entity set', () => {
    const plan = validPlan() as ReturnType<typeof validPlan> & { universe?: unknown };
    plan.universe = {
      version: 1,
      source: { kind: 'equity_market', market: 'CN' },
      asOf: { kind: 'periodic', frequency: 'month_end' },
      eligibility: {
        minimumListedDays: 0,
        suspension: 'exclude',
        riskWarning: 'include',
      },
      predicates: [],
      missing: 'exclude',
      select: [{ measure: 'equity.close', measureVersion: 1 }],
    };
    expect(() => parseResearchPlanSpec(plan)).toThrow(
      'time_series_relationship does not accept a universe input',
    );
  });
});
