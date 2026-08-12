import { describe, expect, it } from 'vitest';
import { buildCodegenPrompt } from './codegen-prompt.js';

describe('strategy codegen prompt published-Factor semantics', () => {
  it('publishes the expanded daily and higher-timeframe indicator surface', () => {
    const prompt = buildCodegenPrompt();

    expect(prompt).toContain('ctx.adx(code,period=14)');
    expect(prompt).toContain('ctx.bollingerBands(code,period=20,standardDeviations=2)');
    expect(prompt).toContain('ctx.rsi(code,period=14)');
    expect(prompt).toContain('ctx.macd(code,fastPeriod=12,slowPeriod=26,signalPeriod=9)');
    expect(prompt).toContain('ctx.kdj(code,period=9,kSmoothing=3,dSmoothing=3)');
    expect(prompt).toContain(
      'sma/ema/atr/highest/lowest/avgAmount/avgVol/adx/bollingerBands/rsi/macd/kdj',
    );
    expect(prompt).not.toContain('SuperTrend');
    expect(prompt).not.toContain('Parabolic SAR');
  });

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
