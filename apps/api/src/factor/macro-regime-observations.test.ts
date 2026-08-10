import type { MacroRegimeFactorResearchSpecV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import type { MacroRegimeHistoryV1, MacroRegimeScoreV1 } from '../macro/regime-score.js';
import {
  buildMacroRegimeEvaluationData,
  macroRegimeDecisionTargets,
  type MacroRegimeEtfDailyRow,
} from './macro-regime-observations.js';

const researchSpec: MacroRegimeFactorResearchSpecV1 = {
  version: 1,
  analysisKind: 'macro_regime',
  start: '20240101',
  end: '20240229',
  observationFrequency: 'monthly',
  targetAssets: ['A', 'B'],
  target: { kind: 'forward_total_return', horizon: 1, horizonUnit: 'trade_day' },
  dataPolicy: { pointInTime: true, revisionPolicy: 'latest_vintage', dataCutoff: '20240301' },
  stateModel: { kind: 'threshold', states: 4 },
};

const openDates = ['20240102', '20240131', '20240201', '20240229', '20240301'];

describe('macro regime ETF observations', () => {
  it('uses exact month-end and target-date adjusted prices without stale filling', () => {
    const history = scoreHistory([
      score('20240131', 'growth_strong_inflation_low'),
      score('20240229', 'growth_weak_inflation_high'),
    ]);
    const rows: MacroRegimeEtfDailyRow[] = [
      bar('A', '20240131', 100, 1),
      bar('A', '20240201', 55, 2),
      bar('A', '20240229', 60, 2),
      bar('A', '20240301', 57, 2),
      bar('B', '20240131', 50, 1),
      bar('B', '20240229', 50, 1),
      bar('B', '20240301', 55, 1),
    ];

    const result = buildMacroRegimeEvaluationData(researchSpec, rows, openDates, history);

    expect(result.periods.map((period) => period.targetDate)).toEqual(['20240201', '20240301']);
    expect(
      result.observations.map((observation) => [
        observation.assetId,
        observation.asOfDate,
        Number(observation.forwardReturn.toFixed(6)),
      ]),
    ).toEqual([
      ['A', '20240131', 0.1],
      ['A', '20240229', -0.05],
      ['B', '20240229', 0.1],
    ]);
    expect(result.skippedTargetDates).toEqual([]);
    expect(result.skippedMacroDates).toEqual([]);
  });

  it('records a month whose target extends beyond the frozen data cutoff', () => {
    const cutoffSpec: MacroRegimeFactorResearchSpecV1 = {
      ...researchSpec,
      dataPolicy: { ...researchSpec.dataPolicy, dataCutoff: '20240229' },
    };

    expect(macroRegimeDecisionTargets(cutoffSpec, openDates)).toEqual({
      eligible: [{ asOfDate: '20240131', targetDate: '20240201' }],
      skipped: ['20240229'],
    });
  });

  it('rejects a score that was not frozen to an eligible decision date', () => {
    const history = scoreHistory([score('20240229', 'growth_weak_inflation_high')]);
    const cutoffSpec: MacroRegimeFactorResearchSpecV1 = {
      ...researchSpec,
      dataPolicy: { ...researchSpec.dataPolicy, dataCutoff: '20240229' },
    };

    expect(() => buildMacroRegimeEvaluationData(cutoffSpec, [], openDates, history)).toThrow(
      'has no frozen target date',
    );
  });

  it('fails closed on a missing adjustment factor', () => {
    expect(() =>
      buildMacroRegimeEvaluationData(
        researchSpec,
        [bar('A', '20240131', 100, Number.NaN)],
        openDates,
        scoreHistory([score('20240131', 'growth_strong_inflation_low')]),
      ),
    ).toThrow('ETF data is incomplete');
  });
});

function scoreHistory(scores: MacroRegimeScoreV1[]): MacroRegimeHistoryV1 {
  return {
    version: 1,
    revisionPolicy: 'latest_vintage',
    scores,
    skippedDates: [],
  };
}

function score(asOfDate: string, state: MacroRegimeScoreV1['state']): MacroRegimeScoreV1 {
  return {
    version: 1,
    asOfDate,
    featureAvailableDate: asOfDate,
    latestVintageDate: '20240801',
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

function bar(
  assetId: string,
  tradeDate: string,
  close: number,
  adjustmentFactor: number,
): MacroRegimeEtfDailyRow {
  return { assetId, tradeDate, close, adjustmentFactor };
}
