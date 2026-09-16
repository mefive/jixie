import { minusDays } from '#date';
import { t } from '#i18n/messages.js';
import { prisma } from '#infra/database/prisma.js';
import type { UserLogSink } from '#infra/runtime/console.js';
import { StockNameLookup } from '#market/instruments/stock-identity.js';
import * as st from '#math/stats.js';
import type {
  BucketStat,
  FactorAnalysisSpec,
  FactorEvaluationScopeV1,
  FactorMethodologyAudit,
  FactorOutlierSpecV1,
  FactorReport,
  Neutral,
} from '@jixie/shared';
import { DEFAULT_LOCALE, type Locale } from '@jixie/shared';
import {
  combineFactorSeries,
  type FactorAnalysisRuntimeSource,
} from '../../composition/composite.js';
import {
  filterEvaluationUniverse,
  isIndexMembershipFresh,
  PointInTimeIndexMembership,
  rankWithinGroups,
} from '../evaluation-scope.js';
import {
  getRebalanceDates,
  industryOn,
  loadEquityStyleControls,
  loadFinaIndex,
  loadIndustryLookup,
  loadSnapshots,
  type IndustrySpell,
  type Snap,
} from './data.js';
import {
  buildCrossSectionalRobustInference,
  estimateFamaMacbethPeriod,
  type FamaMacbethPeriodAttemptV1,
} from './inference.js';
import { analysisPolicy, applyOutlierPolicy } from './policy.js';
import {
  computeFactorSeries,
  mergeFactorSeriesAudits,
  type FactorSeriesResult,
  type Series,
} from './series.js';

const N_BUCKETS = 10; // deciles
const IC_DECAY_HORIZONS = [1, 5, 10, 20, 60]; // forward horizons (trading days) for the IC-decay curve
const LEGACY_EVALUATION_SCOPE: FactorEvaluationScopeV1 = {
  version: 1,
  universe: { kind: 'market', market: 'cn_a' },
  membership: 'point_in_time',
  rankingScope: 'global',
  diagnostics: [],
};

// —— cross-sectional neutralization (3.4) ——

const NEUTRAL_MIN_GROUP = 5; // industries smaller than this are merged into the largest one before demeaning

/** Relabel members of any group smaller than NEUTRAL_MIN_GROUP into the largest group, so a handful of
 * lone-industry stocks don't each form their own (degenerate, residual-zero) demeaning bucket. */
function mergeSmallGroups(groups: string[]): string[] {
  const counts = new Map<string, number>();
  for (const g of groups) {
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let largest = groups[0];
  for (const [key, count] of counts) {
    if (count > (counts.get(largest) ?? 0)) {
      largest = key;
    }
  }
  return groups.map((g) => ((counts.get(g) ?? 0) < NEUTRAL_MIN_GROUP ? largest : g));
}

/**
 * Replace each rebalance date's factor values with their neutralized residuals (in place on the map).
 * 'size' regresses out log(total market cap); 'size_industry' additionally removes SW level-1 industry
 * means (FWL — see stats.residualize). Stocks without a positive market cap that day are dropped (can't
 * be size-neutralized); with industry mode, stocks with no known industry go to an 'unknown' bucket that
 * mergeSmallGroups folds away if tiny.
 */
function neutralizeSeries(
  series: Series,
  snaps: Map<string, Snap>,
  industryByStock: Map<string, IndustrySpell[]>,
  mode: Exclude<Neutral, 'none'>,
): void {
  for (const [date, rows] of series) {
    const snap = snaps.get(date);
    const kept: { tsCode: string }[] = [];
    const values: number[] = [];
    const logCaps: number[] = [];
    const groups: string[] = [];
    for (const row of rows) {
      const mktcap = snap?.get(row.tsCode)?.mktcap ?? 0;
      if (mktcap <= 0) {
        continue;
      }
      kept.push({ tsCode: row.tsCode });
      values.push(row.value);
      logCaps.push(Math.log(mktcap));
      groups.push(
        mode === 'size_industry'
          ? (industryOn(industryByStock.get(row.tsCode), date) ?? 'unknown')
          : '',
      );
    }
    const residuals = st.residualize(
      values,
      logCaps,
      mode === 'size_industry' ? mergeSmallGroups(groups) : undefined,
    );
    series.set(
      date,
      kept.map((k, i) => ({ tsCode: k.tsCode, value: residuals[i] })),
    );
  }
}

function neutralizeCandidates<T extends { tsCode: string; value: number; mktcap: number }>(
  candidates: T[],
  date: string,
  industryByStock: Map<string, IndustrySpell[]>,
  mode: Exclude<Neutral, 'none'>,
): T[] {
  const kept = candidates.filter((candidate) => candidate.mktcap > 0);
  const groups = kept.map((candidate) =>
    mode === 'size_industry'
      ? (industryOn(industryByStock.get(candidate.tsCode), date) ?? 'unknown')
      : '',
  );
  const residuals = st.residualize(
    kept.map((candidate) => candidate.value),
    kept.map((candidate) => Math.log(candidate.mktcap)),
    mode === 'size_industry' ? mergeSmallGroups(groups) : undefined,
  );
  return kept.map((candidate, index) => ({ ...candidate, value: residuals[index] }));
}

/**
 * Analyze one factor over a (freq, start, end) window: monthly/weekly cross-sectional deciles + Rank IC
 * + long-short. Values are computed on the fly and held only for this call — the caller persists the
 * returned report, not the values.
 */
export async function analyzeFactor(
  factorKey: string,
  spec: FactorAnalysisSpec,
  onLog: (msg: string) => void = () => {},
  onUserLog?: UserLogSink,
  locale: Locale = DEFAULT_LOCALE,
  source?: FactorAnalysisRuntimeSource,
): Promise<FactorReport> {
  const { freq, start, end, neutral } = spec;
  const policy = analysisPolicy(spec);
  const periodsPerYear = freq === 'week' ? 52 : 12;
  const rebalanceDates = await getRebalanceDates(freq, start, end);
  const scopeAware = spec.version === 5 || spec.version === 6;
  const evaluationScope = scopeAware ? spec.evaluationScope : LEGACY_EVALUATION_SCOPE;
  const indexMembership =
    evaluationScope.universe.kind === 'index'
      ? new PointInTimeIndexMembership(
          await prisma.indexWeight.findMany({
            where: {
              indexCode: evaluationScope.universe.indexCode,
              tradeDate: { lte: end },
            },
            select: { conCode: true, tradeDate: true },
            orderBy: { tradeDate: 'asc' },
          }),
        )
      : undefined;
  const freqLabel = t(locale, freq === 'week' ? 'freqWeek' : 'freqMonth');
  onLog(t(locale, 'factorRebalanceDates', { count: rebalanceDates.length, freq: freqLabel }));
  const snaps = await loadSnapshots(rebalanceDates, true); // rebalance snaps carry total market cap for cap-weighting
  const preloadedFinaIndex = spec.version === 6 ? await loadFinaIndex() : undefined;
  onLog(t(locale, 'factorComputingValues', { factor: factorKey }));
  let computed: FactorSeriesResult;
  if (source?.kind === 'composite') {
    const results: Array<{ factor: string; result: FactorSeriesResult }> = [];
    for (const component of source.components) {
      onLog(t(locale, 'factorComputingValues', { factor: component.label }));
      const result = await computeFactorSeries(
        component.factor,
        rebalanceDates,
        snaps,
        onLog,
        onUserLog,
        locale,
        component.code,
        policy.minimumWindowCoverage,
        preloadedFinaIndex,
        component.language,
      );
      transformSeriesOutliers(result.series, policy.factorExposure);
      results.push({ factor: component.factor, result });
    }
    computed = {
      series: combineFactorSeries(
        results.map(({ factor, result }) => ({ factor, series: result.series })),
        source.definition,
      ),
      audit: mergeFactorSeriesAudits(results.map(({ result }) => result.audit)),
    };
  } else if (!source || source.kind === 'single') {
    computed = await computeFactorSeries(
      factorKey,
      rebalanceDates,
      snaps,
      onLog,
      onUserLog,
      locale,
      source?.code,
      policy.minimumWindowCoverage,
      preloadedFinaIndex,
      source?.language,
    );
    transformSeriesOutliers(computed.series, policy.factorExposure);
  } else {
    throw new Error('Cross-sectional analysis received an asset-scope factor source.');
  }
  const byDate = computed.series;
  const equityStyleControls =
    spec.version === 6
      ? await loadEquityStyleControls(spec, rebalanceDates, snaps, preloadedFinaIndex!)
      : undefined;
  const needsIndustry =
    neutral === 'size_industry' ||
    evaluationScope.rankingScope === 'within_industry' ||
    evaluationScope.diagnostics.includes('industry');
  const industryByStock = needsIndustry
    ? await loadIndustryLookup()
    : new Map<string, IndustrySpell[]>();
  if (evaluationScope.rankingScope === 'within_industry') {
    if (industryByStock.size === 0) {
      throw new Error(t(locale, 'factorIndustryHistoryMissing'));
    }
    onLog(t(locale, 'factorRankingWithinIndustry'));
  }

  // Cross-sectional neutralization (3.4): replace raw values with residuals before IC / bucketing.
  // Scope-aware protocols defer this step until after the formal universe and eligibility filters, so
  // neutralization is estimated inside the declared research population. V1–V4 retain their evaluator.
  if (neutral !== 'none') {
    onLog(t(locale, 'factorNeutralizing', { mode: neutral }));
    if (!scopeAware) {
      neutralizeSeries(byDate, snaps, industryByStock, neutral);
    }
  }

  // IC-decay: for each rebalance date D, the trading day D+h (h ∈ horizons) via the open-day calendar,
  // and a snapshot at those forward days — so we can measure Rank IC at multiple forward horizons.
  const calendar = (
    await prisma.tradeCal.findMany({
      where: { exchange: 'SSE', isOpen: 1, calDate: { gte: start, lte: minusDays(end, -130) } },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    })
  ).map((r) => r.calDate);
  const calIndex = new Map(calendar.map((d, i) => [d, i]));
  // Subsample icDecay observations to ≤130 evenly-spaced rebalance dates — enough for a stable mean IC,
  // and it bounds the forward-snapshot load regardless of freq (weekly would otherwise load huge panels).
  const decayStep = Math.max(1, Math.ceil(rebalanceDates.length / 130));
  const decayDates = new Set(rebalanceDates.filter((_, i) => i % decayStep === 0));
  const forwardDates = new Set<string>();
  for (const d of decayDates) {
    const i = calIndex.get(d);
    if (i == null) {
      continue;
    }
    for (const h of IC_DECAY_HORIZONS) {
      if (calendar[i + h]) {
        forwardDates.add(calendar[i + h]);
      }
    }
  }
  onLog(t(locale, 'factorLoadingDecaySnapshots', { count: forwardDates.size }));
  const forwardSnaps = await loadSnapshots([...forwardDates]);
  const decaySeries: number[][] = IC_DECAY_HORIZONS.map(() => []);

  // List date per stock, to enforce the configured minimum listing age. Missing metadata fails open.
  const firstBar = new Map(
    (await prisma.stockBasic.findMany({ select: { tsCode: true, listDate: true } })).map((s) => [
      s.tsCode,
      s.listDate ?? '00000000',
    ]),
  );
  const stockNames =
    spec.version >= 3
      ? new StockNameLookup(
          await prisma.stockNameHistory.findMany({
            select: { tsCode: true, name: true, startDate: true, endDate: true },
            orderBy: [{ tsCode: 'asc' }, { startDate: 'asc' }],
          }),
        )
      : new StockNameLookup([]);
  const stageTotals = {
    factorValue: { before: 0, after: 0 },
    quotes: { before: 0, after: 0 },
    evaluationUniverse: { before: 0, after: 0 },
    rankingScope: { before: 0, after: 0 },
    listingAge: { before: 0, after: 0 },
    riskWarning: { before: 0, after: 0 },
    pendingDelisting: { before: 0, after: 0 },
    liquidity: { before: 0, after: 0 },
  };
  const rankingTotals = {
    missingClassification: 0,
    undersizedGroup: 0,
    groupsEvaluated: 0,
  };
  const diagnosticSeries = new Map<
    string,
    {
      dimension: 'industry' | 'size_bucket' | 'liquidity_bucket';
      key: string;
      ics: number[];
      observations: number;
    }
  >();
  let periodsConsidered = 0;

  const icSeries: number[] = [];
  const bucketReturns: number[][] = Array.from({ length: N_BUCKETS }, () => []); // equal-weight
  const bucketReturnsMktcap: number[][] = Array.from({ length: N_BUCKETS }, () => []); // cap-weight
  const lsReturns: number[] = [];
  const lsReturnsMktcap: number[] = [];
  const lsNetReturns: number[] = []; // long-short after per-rebalance trading cost (equal-weight)
  const lsNetReturnsMktcap: number[] = []; // ditto, cap-weight
  const lsPeriodDates: string[] = []; // period-end date per pushed long-short return (for the NAV x-axis)
  const periodObservations: NonNullable<FactorReport['periodObservations']> = [];
  const famaMacbethAttempts: FamaMacbethPeriodAttemptV1[] = [];
  let firstFormationDate: string | null = null; // first non-skipped formation date (NAV starts at 1 here)
  const turnovers: number[] = [];
  // Quantile × forward horizon (daily-normalized): qh[hi][bucket] = per-rebalance-date list of that quantile's daily-average forward return → mean taken at the end
  const qhEqual = IC_DECAY_HORIZONS.map(() =>
    Array.from({ length: N_BUCKETS }, () => [] as number[]),
  );
  const qhMktcap = IC_DECAY_HORIZONS.map(() =>
    Array.from({ length: N_BUCKETS }, () => [] as number[]),
  );
  let prevTop: Set<string> | null = null;
  let prevBottom: Set<string> | null = null;

  for (let m = 0; m < rebalanceDates.length - 1; m++) {
    const date = rebalanceDates[m];
    const nextDate = rebalanceDates[m + 1];
    const snapDate = snaps.get(date);
    const snapNextDate = snaps.get(nextDate);
    const factorValues = byDate.get(date);
    if (!snapDate || !snapNextDate || !factorValues) {
      continue;
    }
    periodsConsidered += 1;
    const minListDate = minusDays(date, policy.minimumListingDays);
    stageTotals.factorValue.before += snapDate.size;
    stageTotals.factorValue.after += factorValues.length;

    // Candidates: factor value + quote this period + quote next period (forward return).
    let candidates: {
      tsCode: string;
      value: number;
      amount: number;
      mktcap: number;
      fwd: number;
    }[] = [];
    stageTotals.quotes.before += factorValues.length;
    for (const { tsCode, value } of factorValues) {
      const a = snapDate.get(tsCode);
      const b = snapNextDate.get(tsCode);
      if (!a || !b) {
        continue;
      }
      candidates.push({
        tsCode,
        value,
        amount: a.amount,
        mktcap: a.mktcap,
        fwd: b.adjClose / a.adjClose - 1,
      });
    }
    stageTotals.quotes.after += candidates.length;
    stageTotals.evaluationUniverse.before += candidates.length;
    const scoped = filterEvaluationUniverse(candidates, evaluationScope, date, indexMembership);
    if (!scoped.hasSnapshot && evaluationScope.universe.kind === 'index') {
      throw new Error(
        t(locale, 'factorUniverseHistoryMissing', {
          index: evaluationScope.universe.indexCode,
          date,
        }),
      );
    }
    if (
      evaluationScope.universe.kind === 'index' &&
      !isIndexMembershipFresh(scoped.snapshotDate!, date)
    ) {
      throw new Error(
        t(locale, 'factorUniverseHistoryStale', {
          index: evaluationScope.universe.indexCode,
          snapshot: scoped.snapshotDate!,
          date,
        }),
      );
    }
    candidates = scoped.rows;
    stageTotals.evaluationUniverse.after += candidates.length;
    const evaluationUniverseSize =
      evaluationScope.universe.kind === 'index' ? scoped.universeSize : snapDate.size;
    stageTotals.listingAge.before += candidates.length;
    const listingEligible = candidates.filter(
      (candidate) => (firstBar.get(candidate.tsCode) ?? '00000000') <= minListDate,
    );
    stageTotals.listingAge.after += listingEligible.length;
    candidates = listingEligible;
    if (spec.version >= 3) {
      stageTotals.riskWarning.before += candidates.length;
      if (policy.excludeRiskWarnings) {
        candidates = candidates.filter(
          (candidate) => !stockNames.at(candidate.tsCode, date).riskWarning,
        );
      }
      stageTotals.riskWarning.after += candidates.length;

      stageTotals.pendingDelisting.before += candidates.length;
      if (policy.excludePendingDelisting) {
        candidates = candidates.filter(
          (candidate) => !stockNames.at(candidate.tsCode, date).pendingDelisting,
        );
      }
      stageTotals.pendingDelisting.after += candidates.length;
    }
    if (spec.version === 1 && candidates.length < policy.minimumCandidates) {
      continue;
    }

    // Liquidity: drop the bottom fraction by turnover.
    stageTotals.liquidity.before += candidates.length;
    candidates.sort((x, y) => x.amount - y.amount);
    candidates = candidates.slice(Math.floor(candidates.length * policy.liquidityDropFraction));
    stageTotals.liquidity.after += candidates.length;
    if (spec.version !== 1 && candidates.length < policy.minimumCandidates) {
      continue;
    }

    if (scopeAware && neutral !== 'none') {
      candidates = neutralizeCandidates(candidates, date, industryByStock, neutral);
    }
    stageTotals.rankingScope.before += candidates.length;
    if (evaluationScope.rankingScope === 'within_industry') {
      const ranked = rankWithinGroups(
        candidates,
        candidates.map((candidate) => industryOn(industryByStock.get(candidate.tsCode), date)),
      );
      rankingTotals.missingClassification += ranked.missingGroup;
      rankingTotals.undersizedGroup += ranked.smallGroup;
      rankingTotals.groupsEvaluated += ranked.groups;
      candidates = ranked.rows;
    }
    stageTotals.rankingScope.after += candidates.length;
    if (spec.version !== 1 && candidates.length < policy.minimumCandidates) {
      continue;
    }

    const values = candidates.map((candidate) => candidate.value);
    const fwdW = applyOutlierPolicy(
      candidates.map((candidate) => candidate.fwd),
      policy.forwardReturn,
    );

    const rankIc = st.spearman(values, fwdW);
    icSeries.push(rankIc); // Rank IC (factor value vs forward return)

    if (spec.version === 6) {
      const controls = equityStyleControls?.get(date);
      famaMacbethAttempts.push(
        estimateFamaMacbethPeriod(
          candidates.flatMap((candidate, index) => {
            const exposure = controls?.get(candidate.tsCode);
            return exposure
              ? [
                  {
                    candidate: candidate.value,
                    forwardReturn: fwdW[index]!,
                    ...exposure,
                  },
                ]
              : [];
          }),
          spec.inference.famaMacbeth.minimumObservationsPerPeriod,
        ),
      );
    }

    if (scopeAware && evaluationScope.diagnostics.length > 0) {
      const collect = (
        dimension: 'industry' | 'size_bucket' | 'liquidity_bucket',
        keys: Array<string | null>,
      ) => {
        const indexesByKey = new Map<string, number[]>();
        for (let index = 0; index < keys.length; index++) {
          const key = keys[index];
          if (!key) {
            continue;
          }
          const indexes = indexesByKey.get(key) ?? [];
          indexes.push(index);
          indexesByKey.set(key, indexes);
        }
        for (const [key, indexes] of indexesByKey) {
          if (indexes.length < 5) {
            continue;
          }
          const id = `${dimension}:${key}`;
          const accumulator = diagnosticSeries.get(id) ?? {
            dimension,
            key,
            ics: [],
            observations: 0,
          };
          accumulator.ics.push(
            st.spearman(
              indexes.map((index) => values[index]),
              indexes.map((index) => fwdW[index]),
            ),
          );
          accumulator.observations += indexes.length;
          diagnosticSeries.set(id, accumulator);
        }
      };
      if (evaluationScope.diagnostics.includes('industry')) {
        collect(
          'industry',
          candidates.map((candidate) => industryOn(industryByStock.get(candidate.tsCode), date)),
        );
      }
      if (evaluationScope.diagnostics.includes('size_bucket')) {
        const sizeBuckets = st.quantileBuckets(
          candidates.map((candidate) => candidate.mktcap),
          3,
        );
        collect(
          'size_bucket',
          sizeBuckets.map((bucket) => ['small', 'mid', 'large'][bucket]),
        );
      }
      if (evaluationScope.diagnostics.includes('liquidity_bucket')) {
        const liquidityBuckets = st.quantileBuckets(
          candidates.map((candidate) => candidate.amount),
          3,
        );
        collect(
          'liquidity_bucket',
          liquidityBuckets.map((bucket) => ['low', 'mid', 'high'][bucket]),
        );
      }
    }

    const buckets = st.quantileBuckets(values, N_BUCKETS); // decile index per candidate

    // Main decile forward returns (next period): equal-weight + cap-weight, plus the top/bottom sets
    // (both legs' membership feeds the net-of-cost turnover).
    const perBucket: { v: number; w: number }[][] = Array.from({ length: N_BUCKETS }, () => []);
    const top = new Set<string>();
    const bottom = new Set<string>();
    for (let i = 0; i < candidates.length; i++) {
      perBucket[buckets[i]].push({ v: fwdW[i], w: candidates[i].mktcap });
      if (buckets[i] === N_BUCKETS - 1) {
        top.add(candidates[i].tsCode);
      } else if (buckets[i] === 0) {
        bottom.add(candidates[i].tsCode);
      }
    }
    for (let b = 0; b < N_BUCKETS; b++) {
      bucketReturns[b].push(equalMean(perBucket[b]));
      bucketReturnsMktcap[b].push(capMean(perBucket[b]));
    }
    const lsGrossEqual = equalMean(perBucket[N_BUCKETS - 1]) - equalMean(perBucket[0]);
    const lsGrossMktcap = capMean(perBucket[N_BUCKETS - 1]) - capMean(perBucket[0]);
    lsReturns.push(lsGrossEqual);
    lsReturnsMktcap.push(lsGrossMktcap);

    // Net-of-cost: charge this rebalance's trading cost. First formation = establish both legs (one side
    // each ≈ one round-trip); later = churn both legs by their turnover × round-trip. Both legs trade, so
    // top and bottom turnover each contribute. Same cost applies to the equal- and cap-weight streams.
    const buyCost = policy.commissionPerSide + policy.slippagePerSide;
    const sellCost = policy.commissionPerSide + policy.stampDutySellSide + policy.slippagePerSide;
    const roundTripCost = buyCost + sellCost;
    const topTurnover = prevTop ? oneWayTurnover(top, prevTop) : null;
    const bottomTurnover = prevBottom ? oneWayTurnover(bottom, prevBottom) : null;
    const periodCost =
      topTurnover != null && bottomTurnover != null
        ? (topTurnover + bottomTurnover) * roundTripCost
        : buyCost + sellCost; // establishment of the two legs
    const lsNetEqual = lsGrossEqual - periodCost;
    lsNetReturns.push(lsNetEqual);
    lsNetReturnsMktcap.push(lsGrossMktcap - periodCost);
    lsPeriodDates.push(nextDate);
    firstFormationDate ??= date;
    periodObservations.push({
      formationDate: date,
      periodEndDate: nextDate,
      rankIc,
      topReturn: equalMean(perBucket[N_BUCKETS - 1]),
      bottomReturn: equalMean(perBucket[0]),
      longShortGrossReturn: lsGrossEqual,
      longShortNetReturn: lsNetEqual,
      topTurnover,
      sampleSize: candidates.length,
      sampleCoverage: evaluationUniverseSize > 0 ? candidates.length / evaluationUniverseSize : 0,
    });

    // IC-decay + per-decile return at each forward horizon (daily-normalized so horizons compare).
    // Only on the subsampled decay dates (bounds the forward-snapshot load; see decayDates above).
    if (decayDates.has(date)) {
      const iCal = calIndex.get(date)!;
      for (let hi = 0; hi < IC_DECAY_HORIZONS.length; hi++) {
        const h = IC_DECAY_HORIZONS[hi];
        const forwardDate = calendar[iCal + h];
        const snapForward = forwardDate ? forwardSnaps.get(forwardDate) : undefined;
        if (!snapForward) {
          continue;
        }
        const hVals: number[] = [];
        const hRets: number[] = [];
        const hb: { v: number; w: number }[][] = Array.from({ length: N_BUCKETS }, () => []);
        for (let i = 0; i < candidates.length; i++) {
          const a = snapDate.get(candidates[i].tsCode);
          const b = snapForward.get(candidates[i].tsCode);
          if (!a || !b) {
            continue;
          }
          const ret = b.adjClose / a.adjClose - 1;
          hVals.push(candidates[i].value);
          hRets.push(ret);
          hb[buckets[i]].push({ v: Math.pow(1 + ret, 1 / h) - 1, w: candidates[i].mktcap }); // daily-normalized
        }
        if (hVals.length >= policy.minimumCandidates) {
          decaySeries[hi].push(st.spearman(hVals, applyOutlierPolicy(hRets, policy.forwardReturn)));
          for (let b = 0; b < N_BUCKETS; b++) {
            if (hb[b].length) {
              qhEqual[hi][b].push(equalMean(hb[b]));
              qhMktcap[hi][b].push(capMean(hb[b]));
            }
          }
        }
      }
    }

    if (topTurnover != null) {
      turnovers.push(topTurnover);
    }
    prevTop = top;
    prevBottom = bottom;
  }

  onLog(t(locale, 'factorAggregating'));
  // Preset and custom factors both label from their Factor row (presets are seeded code rows).
  const label =
    source?.label ??
    (await prisma.factor.findUnique({ where: { id: factorKey }, select: { name: true } }))?.name ??
    factorKey;
  const icMean = st.mean(icSeries);
  const icStd = st.std(icSeries);
  const icir = icStd > 0 ? icMean / icStd : 0;

  const icDecay = IC_DECAY_HORIZONS.map((horizonDays, hi) => {
    const series = decaySeries[hi];
    const mean = st.mean(series);
    const sd = st.std(series);
    return { horizonDays, icMean: mean, icir: sd > 0 ? mean / sd : 0 };
  });

  const toBuckets = (rows: number[][]): BucketStat[] =>
    rows.map((rets, b) => ({
      bucket: b,
      annReturn: st.annualizedReturn(rets, periodsPerYear),
      sharpe: st.sharpe(rets, periodsPerYear),
      maxDrawdown: st.maxDrawdown(st.navFromReturns(rets)),
      navEnd: st.navFromReturns(rets).at(-1)!,
    }));
  const toLongShort = (rets: number[]): FactorReport['longShort'] => ({
    annReturn: st.annualizedReturn(rets, periodsPerYear),
    sharpe: st.sharpe(rets, periodsPerYear),
    maxDrawdown: st.maxDrawdown(st.navFromReturns(rets)),
    navEnd: st.navFromReturns(rets).at(-1)!,
  });
  const buckets = toBuckets(bucketReturns);
  const diagnostics = [...diagnosticSeries.values()]
    .map((slice) => {
      const mean = st.mean(slice.ics);
      const sd = st.std(slice.ics);
      return {
        dimension: slice.dimension,
        key: slice.key,
        periods: slice.ics.length,
        observations: slice.observations,
        rankIcMean: mean,
        rankIcirAnnual: sd > 0 ? (mean / sd) * Math.sqrt(periodsPerYear) : 0,
        rankIcPositiveRate: slice.ics.filter((value) => value > 0).length / slice.ics.length,
      };
    })
    .sort((a, b) => a.dimension.localeCompare(b.dimension) || a.key.localeCompare(b.key));
  const quantileHorizons = IC_DECAY_HORIZONS.map((horizonDays, hi) => ({
    horizonDays,
    equal: qhEqual[hi].map((list) => st.mean(list)),
    mktcap: qhMktcap[hi].map((list) => st.mean(list)),
  }));
  const robustInference =
    spec.version === 6
      ? buildCrossSectionalRobustInference({
          spec,
          rankIc: icSeries,
          equalGross: lsReturns,
          equalNet: lsNetReturns,
          mktcapGross: lsReturnsMktcap,
          mktcapNet: lsNetReturnsMktcap,
          famaMacbethAttempts,
        })
      : undefined;

  // Equal-weight long-short NAV, gross vs net-of-cost — the tradability view. navFromReturns prepends a
  // starting 1, so both series are one longer than the period count; dates lead with the first formation.
  const lsNav =
    firstFormationDate != null
      ? {
          dates: [firstFormationDate, ...lsPeriodDates],
          gross: st.navFromReturns(lsReturns),
          net: st.navFromReturns(lsNetReturns),
        }
      : undefined;
  const dataCutoff =
    (
      await prisma.daily.findFirst({
        where: { tradeDate: { lte: end } },
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      })
    )?.tradeDate ?? end;
  const methodology: FactorMethodologyAudit = {
    specVersion: spec.version,
    ...(scopeAware ? { evaluationScope: spec.evaluationScope } : {}),
    ...(scopeAware
      ? {
          ranking:
            evaluationScope.rankingScope === 'global'
              ? ({ kind: 'global' } as const)
              : ({
                  kind: 'within_industry_percentile',
                  classification: 'sw_l1',
                  minimumGroupSize: 5,
                  ...rankingTotals,
                } as const),
        }
      : {}),
    dataCutoff,
    periodsConsidered,
    periodsAnalyzed: icSeries.length,
    stages: [
      { key: 'factor_value', ...stageTotals.factorValue },
      { key: 'formation_and_forward_quote', ...stageTotals.quotes },
      ...(scopeAware
        ? [
            {
              key: 'evaluation_universe' as const,
              ...stageTotals.evaluationUniverse,
            },
          ]
        : []),
      { key: 'listing_age', ...stageTotals.listingAge },
      ...(spec.version >= 3
        ? [
            { key: 'risk_warning' as const, ...stageTotals.riskWarning },
            { key: 'pending_delisting' as const, ...stageTotals.pendingDelisting },
          ]
        : []),
      { key: 'liquidity', ...stageTotals.liquidity },
      ...(scopeAware ? [{ key: 'ranking_scope' as const, ...stageTotals.rankingScope }] : []),
    ],
    windowCoverage: computed.audit.declaredWindowDays
      ? {
          declaredWindowDays: computed.audit.declaredWindowDays,
          minimumCoverage: computed.audit.minimumCoverage,
          meanCoverage:
            computed.audit.observations > 0
              ? computed.audit.coverageSum / computed.audit.observations
              : 0,
          observations: computed.audit.observations,
          droppedForCoverage: computed.audit.droppedForCoverage,
        }
      : undefined,
    unavailableHistoricalFilters:
      spec.version >= 3
        ? ['negative_equity', 'long_suspension']
        : ['risk_warning', 'pending_delisting', 'negative_equity', 'long_suspension'],
  };

  return {
    factor: factorKey,
    label,
    freq,
    neutral,
    start,
    end,
    periods: icSeries.length,
    icMean,
    icStd,
    icir,
    icirAnnual: icir * Math.sqrt(periodsPerYear),
    icPosRate: icSeries.filter((x) => x > 0).length / (icSeries.length || 1),
    buckets,
    longShort: toLongShort(lsReturns),
    topTurnover: st.mean(turnovers),
    icDecay,
    bucketsMktcap: toBuckets(bucketReturnsMktcap),
    longShortMktcap: toLongShort(lsReturnsMktcap),
    quantileHorizons,
    longShortNet: toLongShort(lsNetReturns),
    longShortNetMktcap: toLongShort(lsNetReturnsMktcap),
    lsNav,
    periodObservations,
    ...(scopeAware && evaluationScope.diagnostics.length > 0 ? { diagnostics } : {}),
    ...(robustInference ? { robustInference } : {}),
    methodology,
  };
}

function transformSeriesOutliers(series: Series, policy: FactorOutlierSpecV1): void {
  for (const rows of series.values()) {
    const transformed = applyOutlierPolicy(
      rows.map((row) => row.value),
      policy,
    );
    for (let index = 0; index < rows.length; index++) {
      rows[index].value = transformed[index];
    }
  }
}

// —— weighting helpers ——

/** One-way turnover of a decile leg: fraction of the current names that weren't in the previous set. */
function oneWayTurnover(current: Set<string>, previous: Set<string>): number {
  if (!current.size) {
    return 0;
  }
  let changed = 0;
  for (const code of current) {
    if (!previous.has(code)) {
      changed++;
    }
  }
  return changed / current.size;
}

/** Equal-weight mean of a bucket's values. */
function equalMean(items: { v: number }[]): number {
  return items.length ? items.reduce((s, x) => s + x.v, 0) / items.length : 0;
}

/** Cap-weight mean: Σ(v·w) / Σw (w = total market cap); 0 if the bucket has no positive-cap names. */
function capMean(items: { v: number; w: number }[]): number {
  let sumW = 0;
  let sumVW = 0;
  for (const x of items) {
    sumW += x.w;
    sumVW += x.v * x.w;
  }
  return sumW > 0 ? sumVW / sumW : 0;
}
