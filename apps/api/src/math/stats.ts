/** Pure statistical functions for backtesting, factor analysis and historical chart replay.
 * Business callers retain their existing numerical conventions; Research uses its Python libraries. */

/**
 * 计算算术均值，空数组按现有约定返回 0。
 * Arithmetic mean (0 for an empty array).
 */
export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/**
 * 计算标准差；sample=true 使用 n−1 分母，否则使用总体分母 n。
 * Standard deviation. sample=true uses the sample (n-1), false uses the population (n).
 */
export function std(xs: number[], sample = true): number {
  if (xs.length < 2) {
    return 0;
  }
  const m = mean(xs);
  const denom = xs.length - (sample ? 1 : 0);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / denom);
}

/**
 * 生成从 1 开始的平均排名，并列值使用其占据名次的均值。
 * Average ranks (1-based; ties take the average rank).
 */
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

/**
 * 计算等长序列的 Pearson 相关系数，调用方须先对齐并过滤输入。
 * Pearson correlation of two equal-length arrays (align/filter them first).
 */
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

/**
 * 对平均排名计算 Pearson 相关，即 Spearman / Rank IC。
 * Spearman rank correlation = Pearson on ranks. I.e. Rank IC.
 */
export function spearman(xs: number[], ys: number[]): number {
  return pearson(averageRanks(xs), averageRanks(ys));
}

/**
 * 将截面值截尾到指定的两侧分位点范围。
 * Cross-sectional winsorization: clip values to the [p, 1-p] quantile range.
 */
export function winsorize(xs: number[], p = 0.01): number[] {
  if (xs.length < 3) {
    return xs.slice();
  }
  const sorted = [...xs].sort((a, b) => a - b);
  const lo = sorted[Math.floor(p * (sorted.length - 1))];
  const hi = sorted[Math.ceil((1 - p) * (sorted.length - 1))];
  return xs.map((x) => (x < lo ? lo : x > hi ? hi : x));
}

/**
 * 按值升序分配 0 到 n−1 的分组编号，保留输入元素顺序。
 * Split elements into n buckets by ascending rank (returns each element's bucket 0..n-1).
 * Bucket 0 = lowest factor value, n-1 = highest.
 */
export function quantileBuckets(values: number[], n: number): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const buckets = new Array<number>(values.length).fill(0);
  for (let r = 0; r < order.length; r++) {
    buckets[order[r][1]] = Math.min(n - 1, Math.floor((r * n) / order.length));
  }
  return buckets;
}

/**
 * 从初始净值 1 开始逐期复利累计收益序列。
 * Build a NAV series from per-period returns (starting at 1).
 */
export function navFromReturns(periodReturns: number[]): number[] {
  const nav = [1];
  for (const r of periodReturns) {
    nav.push(nav[nav.length - 1] * (1 + r));
  }
  return nav;
}

/**
 * 按给定年度期数将逐期收益几何年化。
 * Annualized return (geometric).
 */
export function annualizedReturn(periodReturns: number[], periodsPerYear: number): number {
  if (!periodReturns.length) {
    return 0;
  }
  const cum = periodReturns.reduce((acc, r) => acc * (1 + r), 1);
  return cum ** (periodsPerYear / periodReturns.length) - 1;
}

/**
 * 使用年度无风险利率与给定年度期数计算年化 Sharpe。
 * Annualized Sharpe (rf is the annualized risk-free rate).
 */
export function sharpe(periodReturns: number[], periodsPerYear: number, rf = 0): number {
  if (periodReturns.length < 2) {
    return 0;
  }
  const ex = periodReturns.map((r) => r - rf / periodsPerYear);
  const s = std(ex);
  return s > 0 ? (mean(ex) * periodsPerYear) / (s * Math.sqrt(periodsPerYear)) : 0;
}

/**
 * 计算非正数口径的最大峰谷回撤，如 -0.32 表示下跌 32%。
 * Max drawdown (negative, e.g. -0.32 means a max drop of 32%).
 */
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

/**
 * 计算中位数，空数组按现有约定返回 0。
 * Median (0 for an empty array).
 */
export function median(xs: number[]): number {
  return quantile(xs, 0.5);
}

/**
 * 用线性插值计算 p 分位数，p 的有效范围为 [0, 1]。
 * The p-quantile (0 ≤ p ≤ 1) with linear interpolation; e.g. quantile(xs, 0.9) = 90th percentile.
 */
export function quantile(xs: number[], p: number): number {
  if (!xs.length) {
    return 0;
  }
  const sorted = [...xs].sort((a, b) => a - b);
  const position = Math.min(Math.max(p, 0), 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * 计算等长序列的样本协方差。
 * Sample covariance of two equal-length arrays.
 */
export function covariance(xs: number[], ys: number[]): number {
  if (xs.length < 2) {
    return 0;
  }
  const mx = mean(xs);
  const my = mean(ys);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += (xs[i] - mx) * (ys[i] - my);
  }
  return sum / (xs.length - 1);
}

/**
 * 拟合带截距的一元 OLS 并返回斜率、截距与 R²；收益回归中的截距为每期 alpha。
 * OLS linear regression y = slope·x + intercept; r2 is the coefficient of determination.
 * Classic use: regress stock returns on index returns → slope is beta, intercept is (per-period) alpha.
 */
export function linearRegression(
  xs: number[],
  ys: number[],
): { slope: number; intercept: number; r2: number } {
  const varX = std(xs) ** 2;
  if (xs.length < 2 || varX === 0) {
    return { slope: 0, intercept: mean(ys), r2: 0 };
  }
  const slope = covariance(xs, ys) / varX;
  const intercept = mean(ys) - slope * mean(xs);
  const r = pearson(xs, ys);
  return { slope, intercept, r2: r * r };
}

/**
 * 按平行分组键减去组均值，等价于剔除组虚拟变量的截面效应。
 * Subtract each value's group mean (within-group demeaning). Groups are given by a parallel key array.
 * This is exactly "regress out a set of group dummies": the demeaned series is the residual after
 * removing per-group intercepts — the industry half of a market-cap + industry neutralization.
 */
export function groupDemean(values: number[], groups: string[]): number[] {
  const sums = new Map<string, { sum: number; count: number }>();
  for (let i = 0; i < values.length; i++) {
    const acc = sums.get(groups[i]) ?? { sum: 0, count: 0 };
    acc.sum += values[i];
    acc.count += 1;
    sums.set(groups[i], acc);
  }
  const groupMean = new Map<string, number>();
  for (const [key, acc] of sums) {
    groupMean.set(key, acc.sum / acc.count);
  }
  return values.map((value, i) => value - groupMean.get(groups[i])!);
}

/**
 * 计算带截距一元 OLS 的残差，作为规模等连续暴露的截面中性化基础。
 * Residuals of an OLS fit y ~ x (with intercept): the part of y that x does not explain. This is the
 * cross-sectional neutralization primitive — regress factor value on log(size) and keep the residual.
 * When `groups` is given, both y and x are group-demeaned first, so the residual is additionally
 * orthogonal to the group dummies (Frisch–Waugh–Lovell — same result as one multi-variate OLS on
 * x + dummies, without building the design matrix). Returns a residual per input, order preserved.
 */
export function residualize(ys: number[], xs: number[], groups?: string[]): number[] {
  const y = groups ? groupDemean(ys, groups) : ys;
  const x = groups ? groupDemean(xs, groups) : xs;
  const { slope, intercept } = linearRegression(x, y);
  return y.map((yi, i) => yi - (slope * x[i] + intercept));
}
