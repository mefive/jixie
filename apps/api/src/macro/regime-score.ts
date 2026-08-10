import type { FactorMacroRegimeStateKeyV1 } from '@jixie/shared';
import type { Prisma } from '../lib/prisma.js';
import {
  loadMacroVintagesThrough,
  selectMacroObservationsAsOf,
  type MacroAsOfSnapshot,
  type MacroObservationVintageRow,
  type MacroRevisionPolicy,
} from './as-of.js';

export const MACRO_REGIME_SCORE_VERSION = 1 as const;
export const MACRO_REGIME_STANDARDIZATION_MONTHS = 60;
export const MACRO_REGIME_MINIMUM_MONTHS = 24;
export const MACRO_REGIME_MOMENTUM_MONTHS = 3;
export const MACRO_REGIME_Z_SCORE_CAP = 3;
export const MACRO_REGIME_SERIES_KEYS = [
  'cn_pmi_manufacturing',
  'cn_cpi_yoy',
  'cn_ppi_yoy',
] as const;

export type MacroRegimeStateKey = FactorMacroRegimeStateKeyV1;

export interface MacroRegimeAxisV1 {
  score: number;
  levelScore: number | null;
  momentumScore: number | null;
  latestPeriods: string[];
  observations: number;
}

export interface MacroRegimeScoreV1 {
  version: typeof MACRO_REGIME_SCORE_VERSION;
  asOfDate: string;
  featureAvailableDate: string;
  latestVintageDate: string;
  revisionPolicy: MacroAsOfSnapshot['revisionPolicy'];
  state: MacroRegimeStateKey;
  growth: MacroRegimeAxisV1 & {
    pmi: number;
    pmiGap: number;
    pmiThreeMonthChange: number | null;
  };
  inflation: MacroRegimeAxisV1 & {
    cpiYoY: number;
    ppiYoY: number;
    cpiThreeMonthChange: number | null;
    ppiThreeMonthChange: number | null;
  };
  disclosure: MacroAsOfSnapshot['disclosure'] & {
    pointInTimeEligible: boolean;
  };
}

export interface MacroRegimeHistoryV1 {
  version: typeof MACRO_REGIME_SCORE_VERSION;
  revisionPolicy: MacroRevisionPolicy;
  scores: MacroRegimeScoreV1[];
  skippedDates: string[];
}

export interface MacroRegimeHistoryOptions {
  decisionDates: string[];
  revisionPolicy: MacroRevisionPolicy;
  dataCutoff?: string | null;
}

interface SeriesPoint {
  period: string;
  value: number;
  availableDate: string;
  vintageDate: string;
}

interface SeriesScore {
  latest: SeriesPoint;
  observations: number;
  threeMonthChange: number | null;
  levelScore: number | null;
  momentumScore: number | null;
}

export class MacroRegimeInsufficientHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MacroRegimeInsufficientHistoryError';
  }
}

/** Loads a macro vintage window once and evaluates the same PIT rule at every decision date. */
export async function loadMacroRegimeScoreHistory(
  database: Prisma,
  options: MacroRegimeHistoryOptions,
): Promise<MacroRegimeHistoryV1> {
  const decisionDates = validateDecisionDates(options.decisionDates);
  const rows = await loadMacroVintagesThrough(database, {
    seriesKeys: [...MACRO_REGIME_SERIES_KEYS],
    throughDate: decisionDates.at(-1)!,
    revisionPolicy: options.revisionPolicy,
    dataCutoff: options.dataCutoff,
  });
  return buildMacroRegimeScoreHistory(rows, { ...options, decisionDates });
}

export function buildMacroRegimeScoreHistory(
  rows: MacroObservationVintageRow[],
  options: MacroRegimeHistoryOptions,
): MacroRegimeHistoryV1 {
  const decisionDates = validateDecisionDates(options.decisionDates);
  const scores: MacroRegimeScoreV1[] = [];
  const skippedDates: string[] = [];
  for (const decisionDate of decisionDates) {
    const snapshot = selectMacroObservationsAsOf(rows, {
      seriesKeys: [...MACRO_REGIME_SERIES_KEYS],
      decisionDate,
      revisionPolicy: options.revisionPolicy,
      dataCutoff: options.dataCutoff,
    });
    try {
      scores.push(computeMacroRegimeScore(snapshot));
    } catch (error) {
      if (!(error instanceof MacroRegimeInsufficientHistoryError)) {
        throw error;
      }
      skippedDates.push(decisionDate);
    }
  }
  return {
    version: MACRO_REGIME_SCORE_VERSION,
    revisionPolicy: options.revisionPolicy,
    scores,
    skippedDates,
  };
}

/** Computes transparent growth/inflation axes from one already PIT-gated macro snapshot. */
export function computeMacroRegimeScore(snapshot: MacroAsOfSnapshot): MacroRegimeScoreV1 {
  if (
    snapshot.observations.some(
      (observation) =>
        observation.availableDate > snapshot.decisionDate ||
        (snapshot.revisionPolicy === 'as_available' &&
          observation.vintageDate > snapshot.decisionDate),
    )
  ) {
    throw new Error(
      'Macro regime snapshot contains observations unavailable on the decision date.',
    );
  }
  const pmi = scoreSeries(snapshot.observations, 'cn_pmi_manufacturing');
  const cpi = scoreSeries(snapshot.observations, 'cn_cpi_yoy');
  const ppi = scoreSeries(snapshot.observations, 'cn_ppi_yoy');
  const growthScore = meanAvailable([pmi.levelScore, pmi.momentumScore]);
  const inflationLevelScore = meanAvailable([cpi.levelScore, ppi.levelScore]);
  const inflationMomentumScore = meanAvailable([cpi.momentumScore, ppi.momentumScore]);
  const inflationScore = meanAvailable([inflationLevelScore, inflationMomentumScore]);
  if (growthScore == null || inflationScore == null) {
    throw new MacroRegimeInsufficientHistoryError(
      'Macro regime history has insufficient variation for a continuous score.',
    );
  }

  return {
    version: MACRO_REGIME_SCORE_VERSION,
    asOfDate: snapshot.decisionDate,
    featureAvailableDate: maximumDate([
      pmi.latest.availableDate,
      cpi.latest.availableDate,
      ppi.latest.availableDate,
    ]),
    latestVintageDate: maximumDate([
      pmi.latest.vintageDate,
      cpi.latest.vintageDate,
      ppi.latest.vintageDate,
    ]),
    revisionPolicy: snapshot.revisionPolicy,
    state: stateKey(growthScore, inflationScore),
    growth: {
      score: growthScore,
      levelScore: pmi.levelScore,
      momentumScore: pmi.momentumScore,
      latestPeriods: [pmi.latest.period],
      observations: pmi.observations,
      pmi: pmi.latest.value,
      pmiGap: pmi.latest.value - 50,
      pmiThreeMonthChange: pmi.threeMonthChange,
    },
    inflation: {
      score: inflationScore,
      levelScore: inflationLevelScore,
      momentumScore: inflationMomentumScore,
      latestPeriods: [cpi.latest.period, ppi.latest.period],
      observations: Math.min(cpi.observations, ppi.observations),
      cpiYoY: cpi.latest.value,
      ppiYoY: ppi.latest.value,
      cpiThreeMonthChange: cpi.threeMonthChange,
      ppiThreeMonthChange: ppi.threeMonthChange,
    },
    disclosure: {
      ...snapshot.disclosure,
      pointInTimeEligible:
        snapshot.revisionPolicy === 'as_available' && snapshot.disclosure.futureVintageRows === 0,
    },
  };
}

function scoreSeries(rows: MacroObservationVintageRow[], seriesKey: string): SeriesScore {
  const points = rows
    .filter((row) => row.seriesKey === seriesKey)
    .map((row) => ({
      period: row.period,
      value: row.value,
      availableDate: row.availableDate,
      vintageDate: row.vintageDate,
    }))
    .sort((left, right) => left.period.localeCompare(right.period));
  if (points.length < MACRO_REGIME_MINIMUM_MONTHS) {
    throw new MacroRegimeInsufficientHistoryError(
      `Macro regime requires at least ${MACRO_REGIME_MINIMUM_MONTHS} observations for ${seriesKey}.`,
    );
  }
  const periodMap = new Map<string, number>();
  for (const point of points) {
    if (periodMap.has(point.period)) {
      throw new Error(`Macro regime received duplicate period ${seriesKey} ${point.period}.`);
    }
    periodMap.set(point.period, point.value);
  }
  const latest = points.at(-1)!;
  const changes = points.flatMap((point) => {
    const previous = periodMap.get(addMonths(point.period, -MACRO_REGIME_MOMENTUM_MONTHS));
    return previous == null ? [] : [{ period: point.period, value: point.value - previous }];
  });
  const latestChange = changes.find((point) => point.period === latest.period)?.value ?? null;

  return {
    latest,
    observations: points.length,
    threeMonthChange: latestChange,
    levelScore: trailingZScore(points),
    momentumScore: trailingZScore(changes),
  };
}

function trailingZScore(points: Array<{ value: number }>): number | null {
  const values = points.slice(-MACRO_REGIME_STANDARDIZATION_MONTHS).map((point) => point.value);
  if (values.length < MACRO_REGIME_MINIMUM_MONTHS) {
    return null;
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  const standardDeviation = Math.sqrt(variance);
  if (!Number.isFinite(standardDeviation) || standardDeviation <= Number.EPSILON) {
    return null;
  }
  const score = (values.at(-1)! - average) / standardDeviation;
  return Math.max(-MACRO_REGIME_Z_SCORE_CAP, Math.min(MACRO_REGIME_Z_SCORE_CAP, score));
}

function meanAvailable(values: Array<number | null>): number | null {
  const available = values.filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  return available.length === 0
    ? null
    : available.reduce((sum, value) => sum + value, 0) / available.length;
}

function stateKey(growthScore: number, inflationScore: number): MacroRegimeStateKey {
  const growth = growthScore >= 0 ? 'growth_strong' : 'growth_weak';
  const inflation = inflationScore >= 0 ? 'inflation_high' : 'inflation_low';
  return `${growth}_${inflation}` as MacroRegimeStateKey;
}

function addMonths(period: string, months: number): string {
  const date = new Date(
    Date.UTC(Number(period.slice(0, 4)), Number(period.slice(4, 6)) - 1 + months),
  );
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function validateDecisionDates(decisionDates: string[]): string[] {
  const sorted = [...decisionDates].sort();
  if (
    sorted.length === 0 ||
    new Set(sorted).size !== sorted.length ||
    sorted.some((date) => !/^\d{8}$/.test(date))
  ) {
    throw new Error('Macro regime decision dates must be a non-empty unique YYYYMMDD list.');
  }
  return sorted;
}

function maximumDate(dates: string[]): string {
  return dates.reduce((latest, date) => (date > latest ? date : latest));
}
