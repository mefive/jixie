import { describe, expect, it } from 'vitest';
import { compileTimeSeriesFactor } from './compile-time-series-factor.js';

const source = `export default defineFactorV2({
  version: 2,
  name: 'ETF 20-day trend',
  analysisKind: 'time_series',
  outputScope: 'asset',
  frequency: 'daily',
  inputs: ['etf.adjustedClose'],
  targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
  window: 21,
  compute(ctx) {
    const current = ctx.value('etf.adjustedClose');
    const previous = ctx.lag('etf.adjustedClose', 20);
    return current != null && previous != null && previous > 0 ? current / previous - 1 : null;
  },
});`;

describe('compileTimeSeriesFactor', () => {
  it('compiles declared daily asset factors and evaluates aligned history inside the isolate', async () => {
    const factor = await compileTimeSeriesFactor(source);
    try {
      expect(factor).toMatchObject({
        version: 2,
        analysisKind: 'time_series',
        outputScope: 'asset',
        frequency: 'daily',
        inputs: ['etf.adjustedClose'],
        window: 21,
      });
      const prices = Array.from({ length: 24 }, (_value, index) => 100 + index);
      const scores = await factor.computeSeries({ 'etf.adjustedClose': prices }, [20, 21, 22]);
      expect(scores[0]).toBeCloseTo(120 / 100 - 1, 12);
      expect(scores[1]).toBeCloseTo(121 / 101 - 1, 12);
      expect(scores[2]).toBeCloseTo(122 / 102 - 1, 12);
    } finally {
      factor.dispose();
    }
  });

  it('fails closed when a definition declares an unknown field', async () => {
    await expect(
      compileTimeSeriesFactor(source.replace('etf.adjustedClose', 'macro.futureValue')),
    ).rejects.toThrow(/unknown input field/);
  });

  it('computes a bond-price-aligned signal from the point-in-time government curve', async () => {
    const factor = await compileTimeSeriesFactor(`export default defineFactorV2({
      version: 2,
      name: 'CGB 10Y yield decline',
      analysisKind: 'time_series',
      outputScope: 'asset',
      frequency: 'daily',
      inputs: ['rates.cgb.yield.10y'],
      targetAssetClasses: ['fixed_income'],
      window: 3,
      compute(ctx) {
        const current = ctx.value('rates.cgb.yield.10y');
        const previous = ctx.lag('rates.cgb.yield.10y', 2);
        return current != null && previous != null ? (previous - current) * 100 : null;
      },
    });`);
    try {
      const [score] = await factor.computeSeries({ 'rates.cgb.yield.10y': [2.1, 2.08, 2.03] }, [2]);
      expect(score).toBeCloseTo(7, 12);
    } finally {
      factor.dispose();
    }
  });

  it('rejects government-curve inputs for non-fixed-income target classes', async () => {
    await expect(
      compileTimeSeriesFactor(
        source
          .replace("inputs: ['etf.adjustedClose']", "inputs: ['rates.cgb.yield.10y']")
          .replace(
            "targetAssetClasses: ['equity', 'fixed_income', 'commodity']",
            "targetAssetClasses: ['equity']",
          ),
      ),
    ).rejects.toThrow(/target asset classes are incompatible/);
  });

  it('returns null and reports an undeclared runtime access once', async () => {
    const logs: string[] = [];
    const factor = await compileTimeSeriesFactor(
      source.replace("ctx.value('etf.adjustedClose')", "ctx.value('macro.futureValue')"),
      (_level, line) => logs.push(line),
    );
    try {
      expect(await factor.computeSeries({ 'etf.adjustedClose': [100, 101] }, [1, 1])).toEqual([
        null,
        null,
      ]);
      expect(logs).toEqual([
        '[factor-error] Factor code accessed undeclared input macro.futureValue',
      ]);
    } finally {
      factor.dispose();
    }
  });
});
