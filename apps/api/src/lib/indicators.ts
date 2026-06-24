// Pure technical indicators over a price series (ascending by date). Reused by the buy-date
// precompute (Phase 1) and the strategy screen (Phase 2). All inputs should be backward-adjusted.

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
      if (high[t] > hh) hh = high[t];
      if (low[t] < ll) ll = low[t];
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
  if (end - window + 1 < 0) return null;
  let s = 0;
  for (let i = end - window + 1; i <= end; i++) s += values[i];
  return s / window;
}
