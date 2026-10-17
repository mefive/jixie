import type { OhlcBar } from '@jixie/shared/sdk/strategy/contract';

/**
 * 计算窗口内指定字段均值，有效值不足 n 个时返回 null。
 *
 * Mean of a per-bar field over the window, or null if fewer than n valid values.
 */
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

/**
 * 以首窗口均值初始化并递推 EMA，历史不足返回 null。
 *
 * Seed EMA from the initial window mean and update recursively.
 */
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

/**
 * 从相邻 OHLC 真实波幅计算 ATR，要求足够前一根行情。
 *
 * Compute ATR from adjacent-bar true ranges with required prior history.
 */
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

/**
 * 将公开 OHLC 字段名映射为行情记录的对应字段。
 *
 * Map a public OHLC field name to the corresponding bar property.
 */
export function ohlcField(bar: OhlcBar, field: 'open' | 'high' | 'low' | 'close'): number {
  return field === 'open'
    ? bar.adjOpen
    : field === 'high'
      ? bar.adjHigh
      : field === 'low'
        ? bar.adjLow
        : bar.adjClose;
}

/**
 * 计算窗口样本标准差，供策略风险辅助方法。
 *
 * Compute sample dispersion for strategy risk helpers.
 */
export function sampleDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1),
  );
}
