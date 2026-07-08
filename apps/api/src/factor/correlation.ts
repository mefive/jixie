import { DEFAULT_LOCALE, type Locale } from '@jixie/shared';
import type { FactorCorrelation, FactorFreq } from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import type { UserLogSink } from '../lib/sandbox-console.js';
import { t } from '../i18n/messages.js';
import * as st from '../lib/stats.js';
import {
  getRebalanceDates,
  loadSnapshots,
  computeFactorSeries,
  type Snap,
  type Series,
} from './analysis.js';

const SIZE_KEY = 'size'; // the fixed pseudo-factor: log(total market cap), always the last column
const SIZE_LABEL = '市值(ln)';
const MIN_PAIR_STOCKS = 50; // skip a date's pair correlation if fewer than this many stocks overlap

/** Build the log-market-cap "size" pseudo-factor series from the rebalance snapshots, so every real
 * factor's entanglement with size is always visible in the matrix (the "is it just a cap bet?" check). */
function sizeSeries(snaps: Map<string, Snap>): Map<string, Map<string, number>> {
  const byDate = new Map<string, Map<string, number>>();
  for (const [date, snap] of snaps) {
    const col = new Map<string, number>();
    for (const [tsCode, quote] of snap) {
      if (quote.mktcap > 0) {
        col.set(tsCode, Math.log(quote.mktcap));
      }
    }
    byDate.set(date, col);
  }
  return byDate;
}

/** Turn a factor's Series (date → [{tsCode,value}]) into per-date lookup maps for fast pair intersection. */
function toLookup(series: Series): Map<string, Map<string, number>> {
  const byDate = new Map<string, Map<string, number>>();
  for (const [date, rows] of series) {
    const col = new Map<string, number>();
    for (const row of rows) {
      col.set(row.tsCode, row.value);
    }
    byDate.set(date, col);
  }
  return byDate;
}

/** Mean cross-sectional Spearman between two factor columns across the rebalance dates: on each date,
 * rank both on the stocks they share and correlate; average over dates with enough overlap. */
function meanPairwiseSpearman(
  a: Map<string, Map<string, number>>,
  b: Map<string, Map<string, number>>,
  dates: string[],
): { value: number | null; periods: number } {
  const perDate: number[] = [];
  for (const date of dates) {
    const colA = a.get(date);
    const colB = b.get(date);
    if (!colA || !colB) {
      continue;
    }
    // Iterate the smaller column; keep stocks present in both.
    const [small, large] = colA.size <= colB.size ? [colA, colB] : [colB, colA];
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [tsCode, value] of small) {
      const other = large.get(tsCode);
      if (other != null) {
        xs.push(value);
        ys.push(other);
      }
    }
    if (xs.length >= MIN_PAIR_STOCKS) {
      perDate.push(st.spearman(xs, ys));
    }
  }
  return { value: perDate.length ? st.mean(perDate) : null, periods: perDate.length };
}

/**
 * Correlation matrix over 2–8 factors + a fixed size column: on each rebalance date, the pairwise
 * cross-sectional Spearman on the stocks two factors share, averaged over dates. Reuses the single-
 * factor path (computeFactorSeries) per factor, so windowed factors (e.g. momentum) walk their price
 * history exactly as in analyzeFactor. The matrix is symmetric with 1 on the diagonal.
 */
export async function computeFactorCorrelation(
  factorKeys: string[],
  freq: FactorFreq,
  start: string,
  end: string,
  onLog: (msg: string) => void = () => {},
  onUserLog?: UserLogSink,
  locale: Locale = DEFAULT_LOCALE,
): Promise<FactorCorrelation> {
  const rebalanceDates = await getRebalanceDates(freq, start, end);
  const freqLabel = t(locale, freq === 'week' ? 'freqWeek' : 'freqMonth');
  onLog(t(locale, 'factorRebalanceDates', { count: rebalanceDates.length, freq: freqLabel }));
  const snaps = await loadSnapshots(rebalanceDates, true); // withMktcap for the size pseudo-factor

  // One lookup column per factor (reusing the single-factor compute), then the size pseudo-factor last.
  const lookups: Map<string, Map<string, number>>[] = [];
  const labels: string[] = [];
  for (const key of factorKeys) {
    onLog(t(locale, 'factorComputingValues', { factor: key }));
    const series = await computeFactorSeries(key, rebalanceDates, snaps, onLog, onUserLog, locale);
    lookups.push(toLookup(series));
    const row = await prisma.factor.findUnique({ where: { id: key }, select: { name: true } });
    labels.push(row?.name ?? key);
  }
  lookups.push(sizeSeries(snaps));
  labels.push(SIZE_LABEL);
  const keys = [...factorKeys, SIZE_KEY];

  onLog(t(locale, 'factorCorrelating', { count: keys.length }));
  const n = keys.length;
  const matrix: (number | null)[][] = Array.from({ length: n }, () =>
    Array<number | null>(n).fill(null),
  );
  let minPeriods = rebalanceDates.length;
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const { value, periods } = meanPairwiseSpearman(lookups[i], lookups[j], rebalanceDates);
      matrix[i][j] = value;
      matrix[j][i] = value;
      if (periods > 0) {
        minPeriods = Math.min(minPeriods, periods);
      }
    }
  }

  return { keys, labels, freq, start, end, periods: minPeriods, matrix };
}
