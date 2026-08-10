import type { FactorMacroRegimeStateKeyV1, MacroRegimeFactorResearchSpecV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import type { MacroRegimeScoreV1 } from '../macro/regime-score.js';
import { MacroRegimeEvaluator } from './macro-regime-evaluator.js';
import type {
  MacroRegimeEvaluationData,
  MacroRegimeEvaluationObservation,
  MacroRegimeEvaluationPeriod,
} from './macro-regime-observations.js';

const researchSpec: MacroRegimeFactorResearchSpecV1 = {
  version: 1,
  analysisKind: 'macro_regime',
  start: '20240101',
  end: '20241231',
  observationFrequency: 'monthly',
  targetAssets: ['A', 'B'],
  target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
  dataPolicy: { pointInTime: true, revisionPolicy: 'latest_vintage', dataCutoff: '20250131' },
  stateModel: { kind: 'threshold', states: 4 },
};

const dates = [
  '20240131',
  '20240229',
  '20240329',
  '20240430',
  '20240531',
  '20240628',
  '20240731',
  '20240830',
  '20240930',
  '20241031',
  '20241129',
  '20241231',
];
const targetDates = [
  '20240229',
  '20240329',
  '20240430',
  '20240531',
  '20240628',
  '20240731',
  '20240830',
  '20240930',
  '20241031',
  '20241129',
  '20241231',
  '20250131',
];
const states: FactorMacroRegimeStateKeyV1[] = [
  'growth_strong_inflation_high',
  'growth_strong_inflation_high',
  'growth_strong_inflation_low',
  'growth_strong_inflation_low',
  'growth_weak_inflation_high',
  'growth_weak_inflation_high',
  'growth_weak_inflation_low',
  'growth_weak_inflation_low',
  'growth_strong_inflation_high',
  'growth_strong_inflation_high',
  'growth_strong_inflation_low',
  'growth_strong_inflation_low',
];

describe('macro regime evaluator', () => {
  it('reports conditional ETF returns, state episodes, and one-period lag sensitivity', () => {
    const report = new MacroRegimeEvaluator().evaluate(researchSpec, evaluationData());
    const strongHigh = report.states.find((state) => state.key === 'growth_strong_inflation_high')!;
    const asset = strongHigh.byAsset.find((row) => row.assetId === 'A')!;

    expect(report.periods).toBe(12);
    expect(report.observations).toBe(24);
    expect(report.skippedPeriods).toBe(2);
    expect(report.stateTransitions).toBe(5);
    expect(report.pointInTimeEligible).toBe(false);
    expect(report.futureVintageRows).toBe(100);
    expect(strongHigh).toMatchObject({
      periods: 4,
      frequency: 1 / 3,
      episodes: 2,
      averageDurationPeriods: 2,
      maximumDurationPeriods: 2,
    });
    expect(asset.observations).toBe(4);
    expect(asset.meanForwardReturn).toBeCloseTo(0.0245);
    expect(asset.positiveRate).toBe(1);
    expect(asset.neweyWestMeanTStat).not.toBeNull();
    expect(asset.onePeriodLagObservations).toBe(4);
    expect(asset.onePeriodLagMeanForwardReturn).toBeCloseTo(0.0105);
    expect(report.periodReports.every((period) => period.eligibleAssets === 2)).toBe(true);
  });

  it('fails closed when a feature availability date is after its decision date', () => {
    const data = evaluationData();
    data.periods[0] = {
      ...data.periods[0]!,
      score: { ...data.periods[0]!.score, featureAvailableDate: '20240201' },
    };

    expect(() => new MacroRegimeEvaluator().evaluate(researchSpec, data)).toThrow(
      'violates the frozen time policy',
    );
  });

  it('rejects an observation whose frozen state differs from its period', () => {
    const data = evaluationData();
    data.observations[0] = {
      ...data.observations[0]!,
      state: 'growth_weak_inflation_low',
    };

    expect(() => new MacroRegimeEvaluator().evaluate(researchSpec, data)).toThrow(
      'is inconsistent',
    );
  });
});

function evaluationData(): MacroRegimeEvaluationData {
  const periods = dates.map((asOfDate, index) =>
    period(asOfDate, targetDates[index], states[index]),
  );
  const observations = periods.flatMap(({ score, targetDate }, index) => [
    observation('A', score, targetDate, returnFor('A', score.state, index)),
    observation('B', score, targetDate, returnFor('B', score.state, index)),
  ]);
  return {
    periods,
    observations,
    skippedMacroDates: ['20230131'],
    skippedTargetDates: ['20250228'],
  };
}

function period(
  asOfDate: string,
  targetDate: string,
  state: FactorMacroRegimeStateKeyV1,
): MacroRegimeEvaluationPeriod {
  return { score: score(asOfDate, state), targetDate };
}

function score(asOfDate: string, state: FactorMacroRegimeStateKeyV1): MacroRegimeScoreV1 {
  return {
    version: 1,
    asOfDate,
    featureAvailableDate: asOfDate,
    latestVintageDate: '20250131',
    revisionPolicy: 'latest_vintage',
    state,
    growth: {
      score: state.startsWith('growth_strong') ? 1 : -1,
      levelScore: 1,
      momentumScore: 1,
      latestPeriods: [asOfDate.slice(0, 6)],
      observations: 60,
      pmi: 50,
      pmiGap: 0,
      pmiThreeMonthChange: 0,
    },
    inflation: {
      score: state.endsWith('inflation_high') ? 1 : -1,
      levelScore: 1,
      momentumScore: 1,
      latestPeriods: [asOfDate.slice(0, 6), asOfDate.slice(0, 6)],
      observations: 60,
      cpiYoY: 1,
      ppiYoY: 1,
      cpiThreeMonthChange: 0,
      ppiThreeMonthChange: 0,
    },
    disclosure: {
      latestValueBackfillRows: 100,
      futureVintageRows: 100,
      pointInTimeEligible: false,
    },
  };
}

function observation(
  assetId: string,
  regimeScore: MacroRegimeScoreV1,
  targetDate: string,
  forwardReturn: number,
): MacroRegimeEvaluationObservation {
  return {
    assetId,
    asOfDate: regimeScore.asOfDate,
    featureAvailableDate: regimeScore.featureAvailableDate,
    latestVintageDate: regimeScore.latestVintageDate,
    targetDate,
    state: regimeScore.state,
    growthScore: regimeScore.growth.score,
    inflationScore: regimeScore.inflation.score,
    forwardReturn,
  };
}

function returnFor(assetId: string, state: FactorMacroRegimeStateKeyV1, index: number): number {
  const stateBase = {
    growth_strong_inflation_high: 0.02,
    growth_strong_inflation_low: -0.01,
    growth_weak_inflation_high: 0.03,
    growth_weak_inflation_low: -0.02,
  }[state];
  return (assetId === 'A' ? stateBase : -stateBase) + index * 0.001;
}
