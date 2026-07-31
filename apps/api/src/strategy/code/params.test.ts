import { DEFAULT_LOCALE } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { inspectWalledStrategyParameters } from '../../engine/walled-run.js';
import { compileStrategy } from './compile.js';

const CODE = `export default defineStrategy({
  params: { lookback: 20, topFraction: 0.1, sizing: 'equal' },
  onBar(ctx) {
    void ctx.params.lookback;
  },
});`;

describe('strategy params', () => {
  it('infers declarations and applies direct-lane overrides without source rewriting', async () => {
    const strategy = await compileStrategy(CODE, undefined, DEFAULT_LOCALE, { lookback: 40 });
    expect(strategy.params).toEqual({ lookback: 40, topFraction: 0.1, sizing: 'equal' });
  });

  it('applies categorical overrides while rejecting declared-type changes', async () => {
    const strategy = await compileStrategy(CODE, undefined, DEFAULT_LOCALE, { sizing: 'atr' });
    expect(strategy.params?.sizing).toBe('atr');
    await expect(compileStrategy(CODE, undefined, DEFAULT_LOCALE, { sizing: 1 })).rejects.toThrow(
      'match its declared type',
    );
  });

  it('rejects unknown overrides', async () => {
    await expect(compileStrategy(CODE, undefined, DEFAULT_LOCALE, { missing: 1 })).rejects.toThrow(
      'unknown strategy parameter: missing',
    );
  });

  it('inspects defaults inside the hard sandbox', async () => {
    await expect(inspectWalledStrategyParameters(CODE)).resolves.toEqual({
      lookback: 20,
      sizing: 'equal',
      topFraction: 0.1,
    });
  });
});
