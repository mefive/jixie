import { DEFAULT_LOCALE } from '@jixie/shared';
import { describe, expect, it } from 'vitest';
import { inspectWalledStrategyParameters } from '../../engine/walled-run.js';
import { compileStrategy } from './compile.js';

const CODE = `export default defineStrategy({
  params: { lookback: 20, topFraction: 0.1 },
  onBar(ctx) {
    void ctx.params.lookback;
  },
});`;

describe('strategy numeric params', () => {
  it('infers declarations and applies direct-lane overrides without source rewriting', async () => {
    const strategy = await compileStrategy(CODE, undefined, DEFAULT_LOCALE, { lookback: 40 });
    expect(strategy.params).toEqual({ lookback: 40, topFraction: 0.1 });
  });

  it('rejects unknown overrides', async () => {
    await expect(compileStrategy(CODE, undefined, DEFAULT_LOCALE, { missing: 1 })).rejects.toThrow(
      'unknown strategy parameter: missing',
    );
  });

  it('inspects defaults inside the hard sandbox', async () => {
    await expect(inspectWalledStrategyParameters(CODE)).resolves.toEqual({
      lookback: 20,
      topFraction: 0.1,
    });
  });
});
