import { describe, expect, it } from 'vitest';
import { normalizeScanSpec, parameterCombinations, scanCellOverrides } from './scan.js';

describe('strategy parameter scan', () => {
  it('normalizes values, rejects unknown keys, and caps the Cartesian product', () => {
    expect(
      normalizeScanSpec(
        {
          dimensions: [{ key: ' lookback ', values: [10, 20, 20, 40] }],
        },
        { lookback: 20 },
      ),
    ).toEqual({
      dimensions: [{ key: 'lookback', values: [10, 20, 40] }],
      splitDate: undefined,
      view: 'parameters',
    });
    expect(() =>
      normalizeScanSpec({ dimensions: [{ key: 'missing', values: [1, 2] }] }, { lookback: 20 }),
    ).toThrow('unknown strategy parameter');
    expect(() =>
      normalizeScanSpec(
        {
          dimensions: [
            { key: 'lookback', values: [1, 2, 3, 4, 5, 6] },
            { key: 'fraction', values: [0.1, 0.2, 0.3, 0.4, 0.5] },
          ],
        },
        { lookback: 20, fraction: 0.1 },
      ),
    ).toThrow('limited to 25');
  });

  it('supports categorical sizing schemes and rejects mixed-type values', () => {
    expect(
      normalizeScanSpec(
        {
          view: 'sizing',
          dimensions: [{ key: 'sizing', values: ['equal', 'fixed', 'atr', 'atr'] }],
        },
        { sizing: 'equal' },
      ),
    ).toEqual({
      dimensions: [{ key: 'sizing', values: ['equal', 'fixed', 'atr'] }],
      splitDate: undefined,
      view: 'sizing',
    });
    expect(() =>
      normalizeScanSpec(
        { dimensions: [{ key: 'sizing', values: ['equal', 1] }] },
        { sizing: 'equal' },
      ),
    ).toThrow('match its declared type');
  });

  it('normalizes capacity grids independently of declared strategy parameters', () => {
    const spec = normalizeScanSpec(
      {
        view: 'capacity',
        dimensions: [{ key: ' initialCash ', values: [2_000_000, 500_000, 10_000_000] }],
      },
      {},
    );

    expect(spec).toEqual({
      dimensions: [{ key: 'initialCash', values: [500_000, 2_000_000, 10_000_000] }],
      splitDate: undefined,
      view: 'capacity',
    });
    expect(scanCellOverrides(spec, { initialCash: 2_000_000 })).toEqual({
      initialCash: 2_000_000,
      paramOverrides: {},
    });
    expect(() =>
      normalizeScanSpec(
        {
          view: 'capacity',
          dimensions: [{ key: 'initialCash', values: [100_000, 200_000] }],
        },
        {},
      ),
    ).toThrow('3-7 capital values');
  });

  it('builds a stable row-major one- or two-dimensional grid', () => {
    expect(
      parameterCombinations({
        dimensions: [{ key: 'lookback', values: [10, 20] }],
      }),
    ).toEqual([{ lookback: 10 }, { lookback: 20 }]);
    expect(
      parameterCombinations({
        dimensions: [
          { key: 'lookback', values: [10, 20] },
          { key: 'fraction', values: [0.1, 0.2] },
        ],
      }),
    ).toEqual([
      { lookback: 10, fraction: 0.1 },
      { lookback: 10, fraction: 0.2 },
      { lookback: 20, fraction: 0.1 },
      { lookback: 20, fraction: 0.2 },
    ]);
  });
});
