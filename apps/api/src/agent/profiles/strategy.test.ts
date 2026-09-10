import { describe, expect, it } from 'vitest';
import { extractInstrumentCodes, strategyProfile } from './strategy.js';

describe('strategyProfile', () => {
  it.each(['typescript', 'python'] as const)(
    'separates %s code checks from user-run backtests',
    (language) => {
      const profile = strategyProfile(undefined, undefined, language);

      expect(profile.artifact?.language).toBe(language);
      expect(profile.artifact?.validate).toBeTypeOf('function');
      expect(profile.system).toContain('passing that check does not establish trading performance');
      expect(profile.system).toContain('Backtests run only when the user explicitly starts a run');
      expect(profile.system).toContain('Do not run a backtest in the conversation');
      expect(profile.system).toContain('Never claim that generated code has been backtested');
      expect(profile.system).not.toContain('Research execution discipline');
    },
  );
});

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
