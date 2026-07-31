import type { FactorCompositeDefinitionV1 } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { combineFactorSeries } from './composite.js';
import type { Series } from './analysis.js';

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
