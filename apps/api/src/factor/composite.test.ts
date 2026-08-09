import type { FactorCompositeDefinitionV1, FactorPanelCompositeDefinitionV2 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { combineFactorSeries, combinePanelFactorObservations } from './composite.js';
import type { Series } from './analysis.js';
import type { PanelEvaluationObservation } from './panel-evaluator.js';

function series(rows: Array<[string, number]>): Series {
  return new Map([['20240131', rows.map(([tsCode, value]) => ({ tsCode, value }))]]);
}

function definition(
  standardization: FactorCompositeDefinitionV1['standardization'],
): FactorCompositeDefinitionV1 {
  return {
    version: 1,
    name: 'quality-value',
    standardization,
    weighting: 'equal',
    components: [
      { factor: 'quality', direction: 'positive' },
      { factor: 'risk', direction: 'negative' },
    ],
  };
}

describe('combineFactorSeries', () => {
  it('uses the common intersection and centers tied ranks before direction alignment', () => {
    const result = combineFactorSeries(
      [
        {
          factor: 'quality',
          series: series([
            ['A', 1],
            ['B', 1],
            ['C', 3],
            ['ONLY_QUALITY', 9],
          ]),
        },
        {
          factor: 'risk',
          series: series([
            ['A', 3],
            ['B', 2],
            ['C', 1],
            ['ONLY_RISK', 0],
          ]),
        },
      ],
      definition('rank'),
    );

    expect(result.get('20240131')).toEqual([
      { tsCode: 'A', value: -0.375 },
      { tsCode: 'B', value: -0.125 },
      { tsCode: 'C', value: 0.5 },
    ]);
  });

  it('z-scores each component independently and returns zero for constant exposures', () => {
    const result = combineFactorSeries(
      [
        {
          factor: 'quality',
          series: series([
            ['A', 1],
            ['B', 2],
            ['C', 3],
          ]),
        },
        {
          factor: 'risk',
          series: series([
            ['A', 5],
            ['B', 5],
            ['C', 5],
          ]),
        },
      ],
      definition('zscore'),
    );
    const rows = result.get('20240131')!;

    expect(rows[0].value).toBeCloseTo(-0.612372, 6);
    expect(rows[1].value).toBeCloseTo(0, 12);
    expect(rows[2].value).toBeCloseTo(0.612372, 6);
  });

  it('omits dates not present in every component', () => {
    const missingDate: Series = new Map();
    const result = combineFactorSeries(
      [
        { factor: 'quality', series: series([['A', 1]]) },
        { factor: 'risk', series: missingDate },
      ],
      definition('rank'),
    );

    expect(result.size).toBe(0);
  });
});

describe('combinePanelFactorObservations', () => {
  const panelDefinition: FactorPanelCompositeDefinitionV2 = {
    version: 2,
    key: 'momentum_low_vol',
    name: 'Momentum and defensive trend',
    analysisKind: 'panel',
    standardization: 'rank',
    weighting: 'equal',
    components: [
      { factor: 'momentum', direction: 'positive' },
      { factor: 'volatility_trend', direction: 'negative' },
    ],
  };

  function observation(
    assetId: string,
    score: number,
    forwardReturn: number,
  ): PanelEvaluationObservation {
    return {
      assetId,
      assetClass: assetId === 'BOND' ? 'fixed_income' : 'cn_equity',
      asOfDate: '20240131',
      featureAvailableDate: '20240131',
      targetDate: '20240229',
      score,
      forwardReturn,
      volatility: 0.1,
    };
  }

  it('standardizes components on the common date and asset intersection', () => {
    const result = combinePanelFactorObservations(
      [
        {
          factor: 'momentum',
          observations: [
            observation('EQUITY', 3, 0.03),
            observation('BOND', 1, 0.01),
            observation('ONLY_MOMENTUM', 9, 0.09),
          ],
        },
        {
          factor: 'volatility_trend',
          observations: [observation('EQUITY', 1, 0.03), observation('BOND', 3, 0.01)],
        },
      ],
      panelDefinition,
    );

    expect(result.map(({ assetId, score }) => ({ assetId, score }))).toEqual([
      { assetId: 'BOND', score: -0.5 },
      { assetId: 'EQUITY', score: 0.5 },
    ]);
  });

  it('rejects component observations with inconsistent forward targets', () => {
    expect(() =>
      combinePanelFactorObservations(
        [
          { factor: 'momentum', observations: [observation('EQUITY', 3, 0.03)] },
          { factor: 'volatility_trend', observations: [observation('EQUITY', 1, 0.04)] },
        ],
        panelDefinition,
      ),
    ).toThrow('same market observation');
  });
});
