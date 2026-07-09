import { describe, expect, it } from 'vitest';
import { extractInstrumentCodes } from './strategy.js';

describe('extractInstrumentCodes', () => {
  it('finds ts_code literals with any exchange suffix, deduped', () => {
    const code = `
      export default defineStrategy({
        watch: ['600519.SH', '000001.SZ'],
        async onBar(ctx) {
          await ctx.universe('932000.CSI');
          ctx.price('600519.SH'); // duplicate — must not repeat
        },
      });`;
    expect(extractInstrumentCodes(code)).toEqual(['600519.SH', '000001.SZ', '932000.CSI']);
  });

  it('ignores plain numbers, dates, and decimals', () => {
    const code = `const start = '20200101'; const ratio = 123456.78; const n = 600519;`;
    expect(extractInstrumentCodes(code)).toEqual([]);
  });
});
