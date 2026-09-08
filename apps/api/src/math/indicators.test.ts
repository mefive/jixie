import { describe, expect, it } from 'vitest';
import {
  adx,
  adxLookback,
  bollingerBands,
  kdjLookback,
  latestKdj,
  macd,
  macdLookback,
  rsi,
  rsiLookback,
  type TechnicalOhlcBar,
} from './indicators.js';

function trendBars(length: number, change = 1): TechnicalOhlcBar[] {
  return Array.from({ length }, (_unused, index) => {
    const close = 100 + index * change;
    return { adjHigh: close + 1, adjLow: close - 1, adjClose: close };
  });
}

describe('strategy technical indicators', () => {
  it('uses explicit bounded warm-up windows for recursive indicators', () => {
    expect(adxLookback()).toBe(56);
    expect(kdjLookback()).toBe(36);
    expect(rsiLookback()).toBe(57);
    expect(macdLookback()).toBe(112);
    expect(macdLookback(26, 12, 9)).toBe(0);
    expect(rsiLookback(1.5)).toBe(0);
  });

  it('calculates population-standard-deviation Bollinger Bands', () => {
    const bands = bollingerBands([1, 2, 3, 4, 5], 5, 2);

    expect(bands?.middle).toBe(3);
    expect(bands?.upper).toBeCloseTo(3 + Math.sqrt(2) * 2);
    expect(bands?.lower).toBeCloseTo(3 - Math.sqrt(2) * 2);
  });

  it('keeps flat markets neutral and finite', () => {
    const closes = new Array<number>(120).fill(10);
    const bars = closes.map((close) => ({ adjHigh: close, adjLow: close, adjClose: close }));

    expect(rsi(closes)).toBe(50);
    expect(macd(closes)).toEqual({ line: 0, signal: 0, histogram: 0 });
    expect(adx(bars)).toEqual({ adx: 0, positiveDi: 0, negativeDi: 0 });
    expect(latestKdj(bars)?.k).toBeCloseTo(50);
    expect(latestKdj(bars)?.d).toBeCloseTo(50);
    expect(latestKdj(bars)?.j).toBeCloseTo(50);
    expect(bollingerBands(closes)).toEqual({ middle: 10, upper: 10, lower: 10 });
  });

  it('identifies a persistent upward trend without doubling the MACD histogram', () => {
    const bars = trendBars(160);
    const closes = bars.map((bar) => bar.adjClose);
    const directional = adx(bars);
    const convergence = macd(closes);
    const stochastic = latestKdj(bars);

    expect(rsi(closes)).toBe(100);
    expect(directional?.adx).toBeCloseTo(100);
    expect(directional!.positiveDi).toBeGreaterThan(directional!.negativeDi);
    expect(convergence!.line).toBeGreaterThan(0);
    expect(convergence!.histogram).toBeCloseTo(convergence!.line - convergence!.signal);
    expect(stochastic!.k).toBeGreaterThan(50);
    expect(stochastic!.d).toBeGreaterThan(50);
  });

  it('returns null for insufficient history or invalid parameters', () => {
    const bars = trendBars(10);
    const closes = bars.map((bar) => bar.adjClose);

    expect(adx(bars)).toBeNull();
    expect(bollingerBands(closes)).toBeNull();
    expect(rsi(closes)).toBeNull();
    expect(macd(closes)).toBeNull();
    expect(latestKdj(bars, 0)).toBeNull();
    expect(bollingerBands(new Array<number>(20).fill(1), 20, -1)).toBeNull();
  });
});
