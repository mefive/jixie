import { describe, expect, it } from 'vitest';
import { compilePanelFactor, compileTimeSeriesFactor } from './compile-asset-factor.js';

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
  it.each([-1, 0.5])(
    'rejects lag %s inside the SDK and preserves the error boundary',
    async (periods) => {
      const logs: string[] = [];
      const factor = await compileTimeSeriesFactor(
        source.replace(
          "ctx.lag('etf.adjustedClose', 20)",
          `ctx.lag('etf.adjustedClose', ${periods})`,
        ),
        (_level, line) => logs.push(line),
      );
      try {
        expect(await factor.computeSeries({ 'etf.adjustedClose': [100] }, [0, 0])).toEqual([
          null,
          null,
        ]);
        expect(logs).toEqual(['[factor-error] ctx.lag periods must be a non-negative integer']);
      } finally {
        factor.dispose();
      }
    },
  );

  it('returns null for missing, non-finite and out-of-range values without compute errors', async () => {
    const logs: string[] = [];
    const factor = await compileTimeSeriesFactor(source, (_level, line) => logs.push(line));
    try {
      expect(await factor.computeSeries({}, [20])).toEqual([null]);
      const prices = Array.from({ length: 23 }, () => 100);
      prices[21] = NaN;
      prices[22] = Infinity;
      expect(
        await factor.computeSeries({ 'etf.adjustedClose': prices }, [19, 20, 21, 22, 23]),
      ).toEqual([null, 0, null, null, null]);
      expect(logs).toEqual([]);
    } finally {
      factor.dispose();
    }
  });

  it('evaluates aligned history and supports detached context methods inside the isolate', async () => {
    const factor = await compileTimeSeriesFactor(
      source
        .replace('compute(ctx) {', 'compute(ctx) { const { value, lag } = ctx;')
        .replace('ctx.value(', 'value(')
        .replace('ctx.lag(', 'lag('),
    );
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

describe('compilePanelFactor', () => {
  it('compiles a panel definition without treating it as a time-series protocol', async () => {
    const factor = await compilePanelFactor(
      source.replace("analysisKind: 'time_series'", "analysisKind: 'panel'"),
    );
    try {
      expect(factor.analysisKind).toBe('panel');
      const prices = Array.from({ length: 21 }, (_value, index) => 100 + index);
      const [score] = await factor.computeSeries({ 'etf.adjustedClose': prices }, [20]);
      expect(score).toBeCloseTo(0.2, 12);
    } finally {
      factor.dispose();
    }
  });

  it('rejects a time-series definition', async () => {
    await expect(compilePanelFactor(source)).rejects.toThrow('analysisKind=panel');
  });
});
