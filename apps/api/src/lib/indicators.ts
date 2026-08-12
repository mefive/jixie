// Pure technical indicators over a price series (ascending by date). Reused by the buy-date
// precompute (Phase 1) and the strategy screen (Phase 2). All inputs should be backward-adjusted.

export interface AdxResult {
  adx: number;
  positiveDi: number;
  negativeDi: number;
}

export interface BollingerBandsResult {
  middle: number;
  upper: number;
  lower: number;
}

export interface MacdResult {
  line: number;
  signal: number;
  histogram: number;
}

export interface KdjResult {
  k: number;
  d: number;
  j: number;
}

export interface TechnicalOhlcBar {
  adjHigh: number;
  adjLow: number;
  adjClose: number;
}

const RECURSIVE_WARMUP_MULTIPLIER = 4;

export function adxLookback(period = 14): number {
  return recursiveLookback(period);
}

export function kdjLookback(period = 9): number {
  return recursiveLookback(period);
}

export function macdLookback(fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): number {
  if (
    !validPeriod(fastPeriod) ||
    !validPeriod(slowPeriod) ||
    !validPeriod(signalPeriod) ||
    fastPeriod >= slowPeriod
  ) {
    return 0;
  }

  return safeLookback(slowPeriod * RECURSIVE_WARMUP_MULTIPLIER + signalPeriod - 1);
}

export function rsiLookback(period = 14): number {
  if (!validPeriod(period)) {
    return 0;
  }

  return safeLookback(period * RECURSIVE_WARMUP_MULTIPLIER + 1);
}

/** Average Directional Index with Wilder-smoothed positive and negative Directional Indicators. */
export function adx(bars: TechnicalOhlcBar[], period = 14): AdxResult | null {
  if (!validPeriod(period)) {
    return null;
  }

  const values = bars.slice(-adxLookback(period));
  if (values.length < period * 2) {
    return null;
  }

  let smoothedTrueRange = 0;
  let smoothedPositiveMovement = 0;
  let smoothedNegativeMovement = 0;
  for (let barIndex = 1; barIndex <= period; barIndex++) {
    const movement = directionalMovement(values[barIndex - 1], values[barIndex]);
    smoothedTrueRange += movement.trueRange;
    smoothedPositiveMovement += movement.positive;
    smoothedNegativeMovement += movement.negative;
  }

  let directional = directionalValues(
    smoothedTrueRange,
    smoothedPositiveMovement,
    smoothedNegativeMovement,
  );
  const directionalIndices = [directional.dx];
  let averageDirectionalIndex: number | null = period === 1 ? directional.dx : null;
  for (let barIndex = period + 1; barIndex < values.length; barIndex++) {
    const movement = directionalMovement(values[barIndex - 1], values[barIndex]);
    smoothedTrueRange = smoothedTrueRange - smoothedTrueRange / period + movement.trueRange;
    smoothedPositiveMovement =
      smoothedPositiveMovement - smoothedPositiveMovement / period + movement.positive;
    smoothedNegativeMovement =
      smoothedNegativeMovement - smoothedNegativeMovement / period + movement.negative;
    directional = directionalValues(
      smoothedTrueRange,
      smoothedPositiveMovement,
      smoothedNegativeMovement,
    );

    if (directionalIndices.length < period) {
      directionalIndices.push(directional.dx);
      if (directionalIndices.length === period) {
        averageDirectionalIndex = mean(directionalIndices);
      }
    } else {
      averageDirectionalIndex =
        ((averageDirectionalIndex ?? 0) * (period - 1) + directional.dx) / period;
    }
  }

  return averageDirectionalIndex == null
    ? null
    : {
        adx: averageDirectionalIndex,
        positiveDi: directional.positiveDi,
        negativeDi: directional.negativeDi,
      };
}

/** Bollinger Bands over closes; dispersion uses population standard deviation. */
export function bollingerBands(
  closes: number[],
  period = 20,
  standardDeviations = 2,
): BollingerBandsResult | null {
  if (
    !validPeriod(period) ||
    !Number.isFinite(standardDeviations) ||
    standardDeviations < 0 ||
    closes.length < period
  ) {
    return null;
  }

  const values = closes.slice(-period);
  const middle = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - middle) ** 2, 0) / values.length;
  const width = Math.sqrt(variance) * standardDeviations;

  return { middle, upper: middle + width, lower: middle - width };
}

/** Moving Average Convergence Divergence; histogram is line minus signal, without doubling. */
export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdResult | null {
  const lookback = macdLookback(fastPeriod, slowPeriod, signalPeriod);
  if (lookback === 0) {
    return null;
  }

  const values = closes.slice(-lookback);
  if (values.length < slowPeriod + signalPeriod - 1) {
    return null;
  }

  const fastAverage = exponentialMovingAverageSeries(values, fastPeriod);
  const slowAverage = exponentialMovingAverageSeries(values, slowPeriod);
  const lines: number[] = [];
  for (let valueIndex = 0; valueIndex < values.length; valueIndex++) {
    const fast = fastAverage[valueIndex];
    const slow = slowAverage[valueIndex];
    if (fast != null && slow != null) {
      lines.push(fast - slow);
    }
  }
  const signals = exponentialMovingAverageSeries(lines, signalPeriod);
  const line = lines.at(-1);
  const signal = signals.at(-1);

  return line == null || signal == null ? null : { line, signal, histogram: line - signal };
}

/** Relative Strength Index using Wilder smoothing; a flat window is neutral at 50. */
export function rsi(closes: number[], period = 14): number | null {
  const lookback = rsiLookback(period);
  if (lookback === 0) {
    return null;
  }

  const values = closes.slice(-lookback);
  if (values.length < period + 1) {
    return null;
  }

  let averageGain = 0;
  let averageLoss = 0;
  for (let valueIndex = 1; valueIndex <= period; valueIndex++) {
    const change = values[valueIndex] - values[valueIndex - 1];
    averageGain += Math.max(change, 0);
    averageLoss += Math.max(-change, 0);
  }
  averageGain /= period;
  averageLoss /= period;

  for (let valueIndex = period + 1; valueIndex < values.length; valueIndex++) {
    const change = values[valueIndex] - values[valueIndex - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
  }

  if (averageGain === 0 && averageLoss === 0) {
    return 50;
  }
  if (averageLoss === 0) {
    return 100;
  }

  return 100 - 100 / (1 + averageGain / averageLoss);
}

/** Latest KDJ value. RSV uses the period range; K and D are seeded at 50. */
export function latestKdj(
  bars: TechnicalOhlcBar[],
  period = 9,
  kSmoothing = 3,
  dSmoothing = 3,
): KdjResult | null {
  if (!validPeriod(period) || !validPeriod(kSmoothing) || !validPeriod(dSmoothing)) {
    return null;
  }

  const values = bars.slice(-kdjLookback(period));
  if (values.length < period) {
    return null;
  }
  const result = kdj(
    values.map((bar) => bar.adjHigh),
    values.map((bar) => bar.adjLow),
    values.map((bar) => bar.adjClose),
    period,
    kSmoothing,
    dSmoothing,
  );

  return { k: result.k.at(-1)!, d: result.d.at(-1)!, j: result.j.at(-1)! };
}

/**
 * KDJ (stochastic oscillator). Returns k/d/j series aligned to the input. Defaults are the standard
 * KDJ(9,3,3): RSV over `n` bars, K = ((k-1)/k)·Kprev + (1/k)·RSV, D = ((d-1)/d)·Dprev + (1/d)·K,
 * J = 3K − 2D. Seeded with K=D=50. When the n-bar range is flat, K is carried forward (no spike).
 */
export function kdj(
  high: number[],
  low: number[],
  close: number[],
  n = 9,
  k = 3,
  d = 3,
): { k: number[]; d: number[]; j: number[] } {
  const len = close.length;
  const kArr = new Array<number>(len);
  const dArr = new Array<number>(len);
  const jArr = new Array<number>(len);
  let kPrev = 50;
  let dPrev = 50;
  for (let i = 0; i < len; i++) {
    const from = Math.max(0, i - n + 1);
    let hh = -Infinity;
    let ll = Infinity;
    for (let t = from; t <= i; t++) {
      if (high[t] > hh) {
        hh = high[t];
      }
      if (low[t] < ll) {
        ll = low[t];
      }
    }
    const rsv = hh > ll ? ((close[i] - ll) / (hh - ll)) * 100 : kPrev; // flat range → carry K
    const kv = ((k - 1) / k) * kPrev + (1 / k) * rsv;
    const dv = ((d - 1) / d) * dPrev + (1 / d) * kv;
    kArr[i] = kv;
    dArr[i] = dv;
    jArr[i] = 3 * kv - 2 * dv;
    kPrev = kv;
    dPrev = dv;
  }
  return { k: kArr, d: dArr, j: jArr };
}

/** Simple moving average of `values[end-window+1 .. end]`, or null if there isn't enough history. */
export function smaAt(values: number[], end: number, window: number): number | null {
  if (end - window + 1 < 0) {
    return null;
  }
  let s = 0;
  for (let i = end - window + 1; i <= end; i++) {
    s += values[i];
  }
  return s / window;
}

function recursiveLookback(period: number): number {
  return validPeriod(period) ? safeLookback(period * RECURSIVE_WARMUP_MULTIPLIER) : 0;
}

function safeLookback(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function validPeriod(period: number): boolean {
  return Number.isSafeInteger(period) && period > 0;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function exponentialMovingAverageSeries(values: number[], period: number): (number | null)[] {
  const averages = new Array<number | null>(values.length).fill(null);
  if (!validPeriod(period) || values.length < period) {
    return averages;
  }

  let average = mean(values.slice(0, period));
  averages[period - 1] = average;
  const alpha = 2 / (period + 1);
  for (let valueIndex = period; valueIndex < values.length; valueIndex++) {
    average = values[valueIndex] * alpha + average * (1 - alpha);
    averages[valueIndex] = average;
  }

  return averages;
}

function directionalMovement(
  previous: TechnicalOhlcBar,
  current: TechnicalOhlcBar,
): { trueRange: number; positive: number; negative: number } {
  const upwardMove = current.adjHigh - previous.adjHigh;
  const downwardMove = previous.adjLow - current.adjLow;

  return {
    trueRange: Math.max(
      current.adjHigh - current.adjLow,
      Math.abs(current.adjHigh - previous.adjClose),
      Math.abs(current.adjLow - previous.adjClose),
    ),
    positive: upwardMove > downwardMove && upwardMove > 0 ? upwardMove : 0,
    negative: downwardMove > upwardMove && downwardMove > 0 ? downwardMove : 0,
  };
}

function directionalValues(
  smoothedTrueRange: number,
  smoothedPositiveMovement: number,
  smoothedNegativeMovement: number,
): { positiveDi: number; negativeDi: number; dx: number } {
  if (smoothedTrueRange === 0) {
    return { positiveDi: 0, negativeDi: 0, dx: 0 };
  }

  const positiveDi = (100 * smoothedPositiveMovement) / smoothedTrueRange;
  const negativeDi = (100 * smoothedNegativeMovement) / smoothedTrueRange;
  const total = positiveDi + negativeDi;

  return {
    positiveDi,
    negativeDi,
    dx: total === 0 ? 0 : (100 * Math.abs(positiveDi - negativeDi)) / total,
  };
}
