import { describe, expect, it, vi } from 'vitest';
import type { BacktestResult } from '../engine/types.js';
import { executeStrategyScan, normalizeScanSpec, parameterCombinations } from './scan.js';

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

  it('runs every split independently and stores compact summaries', async () => {
    const run = vi.fn(
      async (params: Record<string, number>, range: { start: string; end: string }) =>
        result(params.lookback, range.start, range.end),
    );
    const payload = await executeStrategyScan({
      spec: {
        dimensions: [{ key: 'lookback', values: [10, 20] }],
        splitDate: '20221230',
      },
      parameters: { lookback: 20 },
      ranges: {
        inSample: { start: '20200101', end: '20221230' },
        outOfSample: { start: '20230103', end: '20241231' },
      },
      run,
    });

    expect(run).toHaveBeenCalledTimes(4);
    expect(payload.parameters).toEqual({ lookback: 20 });
    expect(payload.cells[0]).toMatchObject({
      params: { lookback: 10 },
      inSample: { start: '20200101', totalReturn: 0.1 },
      outOfSample: { start: '20230103', totalReturn: 0.1 },
    });
    expect(payload.cells[0]).not.toHaveProperty('inSample.tradeLog');
  });
});

function result(parameter: number, start: string, end: string): BacktestResult {
  return {
    name: 'Fixture',
    start,
    end,
    days: 2,
    initialCash: 100,
    finalValue: 100 + parameter,
    totalReturn: parameter / 100,
    annReturn: parameter / 100,
    sharpe: parameter,
    maxDrawdown: -0.1,
    trades: 1,
    tradeLog: [],
    nav: [],
    benchReturn: 0,
    excessReturn: parameter / 100,
    informationRatio: 1,
    calmar: 1,
    winRate: 1,
    profitFactor: 2,
    turnover: 1,
    totalFees: 1,
    totalSlippage: 2,
    cost: {
      commission: 0,
      minCommission: 0,
      stampDuty: 0,
      transferFee: 0,
      slippageBps: 0,
      impactCoef: 0,
      futureCommissionRate: 0,
      futureCloseTodayRate: 0,
      futureSlippageTicks: 0,
      futureMarginRate: 0.1,
    },
    monthly: [],
  };
}
