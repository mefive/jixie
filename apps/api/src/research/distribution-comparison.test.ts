import type {
  DistributionComparisonPlanSpecV1,
  ResearchUniverseRunResultV1,
  UniverseSpecV1,
} from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { researchUniverseMeasureById } from './catalog.js';
import { concludeDistributionComparison } from './distribution-conclusion.js';
import {
  evaluateDistributionComparison,
  summarizeDistribution,
} from './distribution-comparison.js';
import { executeResearchPlan, type ResearchUniverseExecutor } from './executor.js';
import { parseResearchPlanSpec } from './spec.js';

describe('distribution comparison protocol', () => {
  it('validates two complete, same-date, same-measure universe inputs', () => {
    expect(parseResearchPlanSpec(distributionPlan())).toMatchObject({
      question: { kind: 'distribution_comparison' },
      protocol: { kind: 'distribution_comparison' },
    });
  });

  it('rejects truncation, mismatched dates, measures, and missing evidence outputs', () => {
    const truncated = distributionPlan();
    truncated.inputs[0]!.universe.limit = 20;
    expect(() => parseResearchPlanSpec(truncated)).toThrow('must not truncate');

    const differentDate = distributionPlan();
    differentDate.inputs[1]!.universe.asOf = { kind: 'fixed', date: '20260730' };
    expect(() => parseResearchPlanSpec(differentDate)).toThrow('same requested as-of time');

    const wrongMeasure = distributionPlan();
    wrongMeasure.inputs[1]!.measure.measure = 'equity.pe_ttm';
    wrongMeasure.inputs[1]!.universe.select = [{ measure: 'equity.pe_ttm', measureVersion: 1 }];
    expect(() => parseResearchPlanSpec(wrongMeasure)).toThrow('measure must match');

    const missingSensitivity = distributionPlan();
    missingSensitivity.outputs = missingSensitivity.outputs.filter(
      (output) => output.kind !== 'sensitivity',
    );
    expect(() => parseResearchPlanSpec(missingSensitivity)).toThrow(
      'outputs must include sensitivity',
    );
  });

  it('computes Welch uncertainty, rank evidence, effect size, and winsorized sensitivity', () => {
    const measure = researchUniverseMeasureById.get('equity.pb')!;
    const evaluation = evaluateDistributionComparison(
      distributionPlan().protocol,
      measure,
      observationGroup(
        'groupA',
        'Group A',
        'A',
        Array.from({ length: 30 }, (_, i) => 10 + i / 10),
      ),
      observationGroup(
        'groupB',
        'Group B',
        'B',
        Array.from({ length: 30 }, (_, i) => 5 + i / 10),
      ),
      20,
    );
    const conclusion = concludeDistributionComparison(
      distributionPlan().question,
      evaluation.result,
      evaluation.diagnostics,
    );

    expect(evaluation.result.comparison.meanDifference).toBeCloseTo(5);
    expect(evaluation.result.comparison.meanDifferenceConfidenceInterval95.lower).toBeGreaterThan(
      4,
    );
    expect(evaluation.result.comparison.mannWhitneyTwoSidedPApprox).toBeLessThan(0.001);
    expect(evaluation.result.comparison.cohensD).toBeGreaterThan(5);
    expect(evaluation.result.comparison.winsorizedMeanDifference).toBeCloseTo(5);
    expect(conclusion).toMatchObject({
      level: 'supports',
      direction: 'group_a_higher',
      robustness: { assessment: 'consistent' },
      effectSize: { metric: 'cohens_d', magnitude: 'large' },
    });
  });

  it('keeps a visible outlier sensitivity statistic', () => {
    const summary = summarizeDistribution([...Array(19).fill(1), 1000], 0.05);
    expect(summary.mean).toBeGreaterThan(50);
    expect(summary.winsorizedMean).toBeLessThan(4);
    expect(summary.median).toBe(1);
  });

  it('executes and freezes both resolved groups without generated SQL', async () => {
    const run = await executeResearchPlan(distributionPlan(), {
      executeUniverse: universeExecutor(),
    });

    expect(run.result.kind).toBe('distribution_comparison');
    expect(run.result.groups.map((group) => group.observations.length)).toEqual([30, 30]);
    expect(run.coverage).toEqual([
      expect.objectContaining({ inputId: 'groupA', membersResolved: 30, observationsValid: 30 }),
      expect.objectContaining({ inputId: 'groupB', membersResolved: 30, observationsValid: 30 }),
    ]);
    expect(run.plan.inputs[0]!.universe.source.kind).toBe('explicit');
    expect(run.conclusion.level).toBe('supports');
    expect(run.fingerprints?.data.inputs).toEqual([
      expect.objectContaining({ inputId: 'groupA', observations: 30 }),
      expect.objectContaining({ inputId: 'groupB', observations: 30 }),
    ]);
  });

  it('rejects overlapping entity groups before applying independent-sample inference', async () => {
    const plan = distributionPlan();
    const sharedEntity = plan.inputs[0]!.universe.source;
    if (sharedEntity.kind !== 'explicit') {
      throw new Error('fixture requires explicit entities');
    }
    const sourceB = plan.inputs[1]!.universe.source;
    if (sourceB.kind !== 'explicit') {
      throw new Error('fixture requires explicit entities');
    }
    sourceB.entities[0] = sharedEntity.entities[0]!;

    await expect(
      executeResearchPlan(plan, { executeUniverse: universeExecutor() }),
    ).rejects.toThrow('overlap by 1 entities');
  });
});

function distributionPlan(): DistributionComparisonPlanSpecV1 {
  return {
    version: 1,
    question: {
      version: 1,
      kind: 'distribution_comparison',
      text: 'A 组的市净率是否高于 B 组？',
      hypothesis: {
        estimand: 'mean_difference',
        direction: 'group_a_higher',
        nullValue: 0,
      },
    },
    inputs: [universeInput('groupA', 'Group A', 'A'), universeInput('groupB', 'Group B', 'B')],
    protocol: {
      kind: 'distribution_comparison',
      version: 1,
      groupA: 'groupA',
      groupB: 'groupB',
      measure: { measure: 'equity.pb', measureVersion: 1 },
      inference: { kind: 'welch', confidenceLevel: 0.95 },
      sensitivity: { kind: 'winsorized_mean', tailFraction: 0.05 },
    },
    outputs: [
      { kind: 'summary_table' },
      { kind: 'distribution_boxplot' },
      { kind: 'sensitivity' },
      { kind: 'conclusion' },
      { kind: 'formula' },
      { kind: 'python_example' },
      { kind: 'documentation' },
    ],
  };
}

function universeInput(id: string, label: string, prefix: string) {
  return {
    type: 'universe' as const,
    id,
    label,
    universe: {
      version: 1 as const,
      source: {
        kind: 'explicit' as const,
        entities: Array.from({ length: 30 }, (_, index) => ({
          assetType: 'stock' as const,
          id: `${prefix}${String(index).padStart(3, '0')}`,
        })),
      },
      asOf: { kind: 'fixed' as const, date: '20260731' },
      eligibility: {
        minimumListedDays: 365,
        suspension: 'exclude' as const,
        riskWarning: 'exclude' as const,
      },
      predicates: [],
      missing: 'exclude' as const,
      select: [{ measure: 'equity.pb', measureVersion: 1 as const }],
    },
    measure: { measure: 'equity.pb', measureVersion: 1 as const },
  };
}

function observationGroup(inputId: string, label: string, prefix: string, values: number[]) {
  return {
    inputId,
    label,
    observations: values.map((value, index) => ({
      entity: { assetType: 'stock' as const, id: `${prefix}${index}` },
      name: `${prefix}${index}`,
      value,
    })),
  };
}

function universeExecutor(): ResearchUniverseExecutor {
  return async (input) => {
    const spec = input as UniverseSpecV1;
    if (spec.source.kind !== 'explicit') {
      throw new Error('fixture requires explicit source');
    }
    const isA = spec.source.entities[0]!.id.startsWith('A');
    const rows = spec.source.entities.map((entity, index) => ({
      entity,
      name: entity.id,
      industry: null,
      values: { 'equity.pb': (isA ? 10 : 5) + index / 10 },
    }));
    return {
      version: 1,
      spec,
      requestedAsOfDate: '20260731',
      asOfDate: '20260731',
      membershipAsOfDate: null,
      dataRevision: 7,
      total: rows.length,
      rows,
      measures: [researchUniverseMeasureById.get('equity.pb')!],
      stages: [
        { code: 'source', count: rows.length },
        { code: 'listed', count: rows.length },
        { code: 'not_suspended', count: rows.length },
        { code: 'risk_warning', count: rows.length },
        { code: 'predicates', count: rows.length },
      ],
      diagnostics: [],
    } satisfies ResearchUniverseRunResultV1;
  };
}
