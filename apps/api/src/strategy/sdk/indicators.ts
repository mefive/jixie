import type { OhlcBar } from '@jixie/shared/sdk/strategy/contract';

/** Mean of a per-bar field over the window, or null if fewer than n valid values. */
export function avgField(
  bars: { amount: number | null; vol: number | null }[],
  n: number,
  pick: (bar: { amount: number | null; vol: number | null }) => number | null,
): number | null {
  const values = bars.map(pick).filter((value): value is number => value != null);
  return values.length < n ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function smaValues(values: number[], n: number): number | null {
  return n > 0 && values.length >= n
    ? values.slice(-n).reduce((sum, value) => sum + value, 0) / n
    : null;
}

export function emaValues(values: number[], n: number): number | null {
  if (n <= 0 || values.length < n) {
    return null;
  }
  const alpha = 2 / (n + 1);
  let ema = values[0];
  for (const value of values.slice(1)) {
    ema = value * alpha + ema * (1 - alpha);
  }
  return ema;
}

export function extremeValues(
  values: number[],
  n: number,
  pick: (...values: number[]) => number,
): number | null {
  return n > 0 && values.length >= n ? pick(...values.slice(-n)) : null;
}

export function atrBars(bars: OhlcBar[], n: number): number | null {
  if (n <= 0 || bars.length < n + 1) {
    return null;
  }
  let trueRangeSum = 0;
  for (let barIndex = bars.length - n; barIndex < bars.length; barIndex++) {
    const bar = bars[barIndex];
    const prevClose = bars[barIndex - 1].adjClose;
    trueRangeSum += Math.max(
      bar.adjHigh - bar.adjLow,
      Math.abs(bar.adjHigh - prevClose),
      Math.abs(bar.adjLow - prevClose),
    );
  }
  return trueRangeSum / n;
}

export function ohlcField(bar: OhlcBar, field: 'open' | 'high' | 'low' | 'close'): number {
  return field === 'open'
    ? bar.adjOpen
    : field === 'high'
      ? bar.adjHigh
      : field === 'low'
        ? bar.adjLow
        : bar.adjClose;
}

export function sampleDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1),
  );
}
