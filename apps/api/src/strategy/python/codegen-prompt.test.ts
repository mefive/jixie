import { describe, expect, it } from 'vitest';
import { buildPythonCodegenPrompt } from './codegen-prompt.js';

describe('Python strategy codegen prompt', () => {
  it('publishes the expanded snake_case indicator surface', () => {
    const prompt = buildPythonCodegenPrompt();

    expect(prompt).toContain('ctx.adx(code,period=14)');
    expect(prompt).toContain('ctx.bollinger_bands(code,period=20,standard_deviations=2)');
    expect(prompt).toContain('ctx.rsi(code,period=14)');
    expect(prompt).toContain('ctx.macd(code,fast_period=12,slow_period=26,signal_period=9)');
    expect(prompt).toContain('ctx.kdj(code,period=9,k_smoothing=3,d_smoothing=3)');
    expect(prompt).not.toContain('SuperTrend');
    expect(prompt).not.toContain('Parabolic SAR');
  });
});
