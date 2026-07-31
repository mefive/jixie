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

  it('retains rebased NAV and path-risk metrics only for sizing comparisons', async () => {
    const payload = await executeStrategyScan({
      spec: {
        view: 'sizing',
        dimensions: [{ key: 'sizing', values: ['equal', 'atr'] }],
      },
      parameters: { sizing: 'equal' },
      ranges: { full: { start: '20200101', end: '20200103' } },
      run: async (params) => result(params.sizing === 'atr' ? 20 : 10, '20200101', '20200103'),
    });

    expect(payload.cells[0].nav).toEqual([
      { date: '20200101', value: 1 },
      { date: '20200102', value: 0.9 },
      { date: '20200103', value: 1.1 },
    ]);
    expect(payload.cells[0].full?.annVolatility).toBeGreaterThan(0);
    expect(payload.cells[0].full?.maxUnderwaterDays).toBe(1);
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
    nav: [
      { date: '20200101', value: 100 },
      { date: '20200102', value: 90 },
      { date: '20200103', value: 100 + parameter },
    ],
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
