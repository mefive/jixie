import { describe, expect, it } from 'vitest';
import { buildCodegenPrompt } from './codegen-prompt.js';

describe('strategy codegen prompt published-Factor semantics', () => {
  it('teaches the Agent to consume time-series ETF Factors as per-asset scores', () => {
    const factor = 'ETF trend=etf_trend_20 (published; time_series ETF signal)';
    const prompt = buildCodegenPrompt('沪深300=000300.SH', factor);

    expect(prompt).toContain(factor);
    expect(prompt).toContain('explicit `watch` list');
    expect(prompt).toContain('`ctx.factor(factorKey, code)`');
    expect(prompt).toContain('Use `ctx.period`');
    expect(prompt).toContain('do not substitute report correlation, t-statistic, or hit rate');
  });

  it('keeps panel research diagnostics separate from an executable ETF portfolio', () => {
    const factor =
      'Cross-asset momentum=cross_asset_momentum_120 (published; panel cross-asset factor)';
    const prompt = buildCodegenPrompt('沪深300=000300.SH', factor);

    expect(prompt).toContain(factor);
    expect(prompt).toContain('common dates');
    expect(prompt).toContain('long-only ETF portfolio');
    expect(prompt).toContain(
      "report's equal-weight and long-short series are research diagnostics",
    );
    expect(prompt).toContain('backtest must create actual orders');
  });
});
