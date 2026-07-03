/** Pure statistical functions for backtesting. No side effects, independently verifiable. */

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Standard deviation. sample=true uses the sample (n-1), false uses the population (n). */
export function std(xs: number[], sample = true): number {
  if (xs.length < 2) {
    return 0;
  }
  const m = mean(xs);
  const denom = xs.length - (sample ? 1 : 0);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / denom);
}

/** Average ranks (1-based; ties take the average rank). */
function averageRanks(xs: number[]): number[] {
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(xs.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) {
      j++;
    }
    const avgRank = (i + j) / 2 + 1; // average of ranks i+1..j+1
    for (let k = i; k <= j; k++) {
      ranks[order[k][1]] = avgRank;
    }
    i = j + 1;
  }
  return ranks;
}

export function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

/** Spearman rank correlation = Pearson on ranks. I.e. Rank IC. */
export function spearman(xs: number[], ys: number[]): number {
  return pearson(averageRanks(xs), averageRanks(ys));
}

/** Cross-sectional winsorization: clip values to the [p, 1-p] quantile range. */
export function winsorize(xs: number[], p = 0.01): number[] {
  if (xs.length < 3) {
    return xs.slice();
  }
  const sorted = [...xs].sort((a, b) => a - b);
  const lo = sorted[Math.floor(p * (sorted.length - 1))];
  const hi = sorted[Math.ceil((1 - p) * (sorted.length - 1))];
  return xs.map((x) => (x < lo ? lo : x > hi ? hi : x));
}

/** Split elements into n buckets by ascending rank (returns each element's bucket 0..n-1).
 * Bucket 0 = lowest factor value, n-1 = highest. */
export function quantileBuckets(values: number[], n: number): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const buckets = new Array<number>(values.length).fill(0);
  for (let r = 0; r < order.length; r++) {
    buckets[order[r][1]] = Math.min(n - 1, Math.floor((r * n) / order.length));
  }
  return buckets;
}

/** Build a NAV series from per-period returns (starting at 1). */
export function navFromReturns(periodReturns: number[]): number[] {
  const nav = [1];
  for (const r of periodReturns) {
    nav.push(nav[nav.length - 1] * (1 + r));
  }
  return nav;
}

/** Annualized return (geometric). */
export function annualizedReturn(periodReturns: number[], periodsPerYear: number): number {
  if (!periodReturns.length) {
    return 0;
  }
  const cum = periodReturns.reduce((acc, r) => acc * (1 + r), 1);
  return cum ** (periodsPerYear / periodReturns.length) - 1;
}

/** Annualized Sharpe (rf is the annualized risk-free rate). */
export function sharpe(periodReturns: number[], periodsPerYear: number, rf = 0): number {
  if (periodReturns.length < 2) {
    return 0;
  }
  const ex = periodReturns.map((r) => r - rf / periodsPerYear);
  const s = std(ex);
  return s > 0 ? (mean(ex) * periodsPerYear) / (s * Math.sqrt(periodsPerYear)) : 0;
}

/** Max drawdown (negative, e.g. -0.32 means a max drop of 32%). */
export function maxDrawdown(nav: number[]): number {
  let peak = nav[0] ?? 1;
  let mdd = 0;
  for (const v of nav) {
    if (v > peak) {
      peak = v;
    }
    const dd = v / peak - 1;
    if (dd < mdd) {
      mdd = dd;
    }
  }
  return mdd;
}
