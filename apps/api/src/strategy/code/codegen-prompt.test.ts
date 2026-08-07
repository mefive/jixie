import { describe, expect, it } from 'vitest';
import { buildCodegenPrompt } from './codegen-prompt.js';

describe('strategy codegen prompt factor-release semantics', () => {
  it('teaches the Agent to consume time-series ETF releases as per-asset scores', () => {
    const release =
      'ETF trend etf_trend_20@v1=release:01ARZ3NDEKTSV4RRFFQ69G5FAV (experimental; time_series ETF signal)';
    const prompt = buildCodegenPrompt('沪深300=000300.SH', release);

    expect(prompt).toContain(release);
    expect(prompt).toContain('explicit `watch` list');
    expect(prompt).toContain('`ctx.factor(releaseKey, code)`');
    expect(prompt).toContain('Use `ctx.period`');
    expect(prompt).toContain('do not substitute report correlation, t-statistic, or hit rate');
  });
});
