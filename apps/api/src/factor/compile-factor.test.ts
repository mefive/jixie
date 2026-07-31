import { describe, expect, it } from 'vitest';
import { compileFactor } from './compile-factor.js';
import { factorSourceReferencesHistoryField } from './analysis.js';

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
    const factor = await compileFactor(
      `export default defineFactor({
        name: 'broken',
        compute() { throw new Error('same failure'); },
      });`,
      (_level, line) => logs.push(line),
    );
    try {
      await factor.computeBatch([{ bar: {} as never }, { bar: {} as never }]);
      await factor.computeBatch([{ bar: {} as never }]);
    } finally {
      factor.dispose();
    }

    expect(logs).toEqual(['[factor-error] same failure']);
  });
});
