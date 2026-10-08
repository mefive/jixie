import { FactorRuntime } from '../factor-runtime.js';
import { describe, expect, it } from 'vitest';

import { factorSourceReferencesHistoryField } from '../../execution/cross-sectional/series.js';

describe('Factor SDK inside the isolate', () => {
  it('preserves every history field, tail ordering, nulls and window limits', async () => {
    const factor = await FactorRuntime.start({
      language: 'typescript',
      analysisKind: 'cross_sectional',
      code: `export default defineFactor({
      name: 'history', window: 3,
      compute(bar, ctx) {
        const { history } = ctx;
        const actual = [
          history(2), history(2, 'date'), ctx.history(2, 'amount'),
          ctx.history(2, 'turnoverRateF'), ctx.history(2, 'roe'),
          ctx.history(2, 'grossprofitMargin'), ctx.history(2, 'marketClose'),
          ctx.history(4), ctx.history(0), ctx.history(-1), ctx.history(1, 'unknown'),
        ];
        const expected = [[11, 12], ['20260102', '20260103'], [null, 22],
          [31, 32], [41, null], [51, 52], [61, 62], [], [], [], [12]];
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error('history contract changed: ' + JSON.stringify(actual));
        }
        const copy = ctx.history(2);
        copy[1] = -999;
        return ctx.history(1)[0];
      },
    });`,
    });
    try {
      expect(
        await factor.execute({
          items: [
            {
              bar: {} as never,
              closes: [10, 11, 12],
              dates: ['20260101', '20260102', '20260103'],
              amounts: [20, null, 22],
              turnoverRatesF: [30, 31, 32],
              roes: [40, 41, null],
              grossProfitMargins: [50, 51, 52],
              marketCloses: [60, 61, 62],
            },
          ],
        }),
      ).toEqual([12]);
    } finally {
      factor.close();
    }
  });

  it('reports missing history without failing the whole batch', async () => {
    const logs: string[] = [];
    const factor = await FactorRuntime.start({
      language: 'typescript',
      analysisKind: 'cross_sectional',
      code: `export default defineFactor({
      name: 'missing history', compute(bar, ctx) { return ctx.history(1)[0]; },
    });`,
      onUserLog: (_level, line) => logs.push(line),
    });
    try {
      expect(
        await factor.execute({ items: [{ bar: {} as never }, { bar: {} as never, closes: [12] }] }),
      ).toEqual([null, 12]);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('ctx.history');
    } finally {
      factor.close();
    }
  });
});

describe('factor source history dependencies', () => {
  it('recognizes single, double, and template-quoted history fields', () => {
    expect(factorSourceReferencesHistoryField("ctx.history(20, 'roe')", 'roe')).toBe(true);
    expect(
      factorSourceReferencesHistoryField(
        'ctx.history(504, "grossprofitMargin")',
        'grossprofitMargin',
      ),
    ).toBe(true);
    expect(
      factorSourceReferencesHistoryField('ctx.history(20, `turnoverRateF`)', 'turnoverRateF'),
    ).toBe(true);
    expect(factorSourceReferencesHistoryField('ctx.history(20)', 'roe')).toBe(false);
  });

  it('emits only the first repeated compute error from a batch', async () => {
    const logs: string[] = [];
    const factor = await FactorRuntime.start({
      language: 'typescript',
      analysisKind: 'cross_sectional',
      code: `export default defineFactor({
        name: 'broken',
        compute() { throw new Error('same failure'); },
      });`,
      onUserLog: (_level, line) => logs.push(line),
    });
    try {
      await factor.execute({ items: [{ bar: {} as never }, { bar: {} as never }] });
      await factor.execute({ items: [{ bar: {} as never }] });
    } finally {
      factor.close();
    }

    expect(logs).toEqual(['[factor-error] same failure']);
  });
});
