import {
  MACRO_RISK_AXIS_KEYS_V1,
  type MacroRiskAxisDefinitionV1,
  type MacroRiskAxisKeyV1,
  type RiskDataLineageV1,
} from '@jixie/shared';
import { prisma, type Prisma } from '../lib/prisma.js';
import {
  loadMacroVintagesThrough,
  selectMacroObservationsAsOf,
  type MacroObservationVintageRow,
  type MacroRevisionPolicy,
} from '../macro/as-of.js';
import {
  US_NOMINAL_CURVE_CODE,
  US_REAL_CURVE_CODE,
  USD_CNH_CODE,
} from '../rates/external-market-drivers.js';

export const MACRO_RISK_STANDARDIZATION_MONTHS = 60;
export const MACRO_RISK_MINIMUM_MONTHS = 24;
export const MACRO_RISK_MOMENTUM_MONTHS = 3;
export const MACRO_RISK_Z_SCORE_CAP = 3;

export const MACRO_RISK_SERIES_KEYS = [
  'cn_pmi_manufacturing',
  'cn_cpi_yoy',
  'cn_ppi_yoy',
  'cn_m1_yoy',
  'cn_m2_yoy',
  'cn_shibor_3m',
  'cn_social_financing_increment',
  'cn_social_financing_stock',
] as const;

export const MACRO_RISK_MARKET_SERIES_KEYS = [
  US_NOMINAL_CURVE_CODE,
  US_REAL_CURVE_CODE,
  USD_CNH_CODE,
] as const;

export const MACRO_RISK_AXIS_DEFINITIONS_V1: readonly MacroRiskAxisDefinitionV1[] = [
  {
    version: 1,
    kind: 'macro_risk_axis',
    key: 'growth',
    frequency: 'monthly',
    unit: 'score_change',
    sourceSeries: ['MacroObservation:cn_pmi_manufacturing'],
    pointInTime: true,
  },
  {
    version: 1,
    kind: 'macro_risk_axis',
    key: 'inflation',
    frequency: 'monthly',
    unit: 'score_change',
    sourceSeries: ['MacroObservation:cn_cpi_yoy', 'MacroObservation:cn_ppi_yoy'],
    pointInTime: true,
  },
  {
    version: 1,
    kind: 'macro_risk_axis',
    key: 'liquidity',
    frequency: 'monthly',
    unit: 'score_change',
    sourceSeries: [
      'MacroObservation:cn_m1_yoy',
      'MacroObservation:cn_m2_yoy',
      'MacroObservation:cn_shibor_3m',
    ],
    pointInTime: true,
  },
  {
    version: 1,
    kind: 'macro_risk_axis',
    key: 'credit',
    frequency: 'monthly',
    unit: 'score_change',
    sourceSeries: [
      'MacroObservation:cn_social_financing_increment',
      'MacroObservation:cn_social_financing_stock',
    ],
    pointInTime: true,
  },
  {
    version: 1,
    kind: 'macro_risk_axis',
    key: 'external',
    frequency: 'monthly',
    unit: 'score_change',
    sourceSeries: [
      `YieldCurvePoint:${US_NOMINAL_CURVE_CODE}:10Y`,
      `YieldCurvePoint:${US_REAL_CURVE_CODE}:10Y`,
      `FxDaily:${USD_CNH_CODE}:midClose`,
    ],
    pointInTime: true,
  },
];

export interface MacroRiskMarketObservation {
  seriesKey: (typeof MACRO_RISK_MARKET_SERIES_KEYS)[number];
  sourceDate: string;
  availableDate: string;
  value: number;
}

export interface MacroRiskAxisStateV1 {
  month: string;
  date: string;
  values: Partial<Record<MacroRiskAxisKeyV1, number>>;
  latestAvailableDates: Partial<Record<MacroRiskAxisKeyV1, string>>;
  seriesAvailableThrough: Record<string, string>;
  pointInTimeEligible: boolean;
  futureVintageRows: number;
}

export interface MacroRiskAxisObservationV1 {
  date: string;
  values: Partial<Record<MacroRiskAxisKeyV1, number>>;
}

export interface MacroRiskAxisHistoryV1 {
  version: 1;
  definitions: readonly MacroRiskAxisDefinitionV1[];
  revisionPolicy: MacroRevisionPolicy;
  states: MacroRiskAxisStateV1[];
  observations: MacroRiskAxisObservationV1[];
  skippedDates: string[];
  lineage: RiskDataLineageV1;
}

export interface BuildMacroRiskAxisHistoryOptions {
  decisionDates: string[];
  revisionPolicy: MacroRevisionPolicy;
  dataCutoff?: string | null;
  outputStartDate?: string | null;
}

interface MonthlyPoint {
  month: string;
  value: number;
  availableDate: string;
}

interface ScoredPoint {
  score: number;
  availableDate: string;
}

interface AxisValue {
  score: number;
  availableDate: string;
}

/** Builds transparent five-axis macro states and their month-over-month score changes. */
export function buildMacroRiskAxisHistory(
  macroRows: MacroObservationVintageRow[],
  marketRows: MacroRiskMarketObservation[],
  options: BuildMacroRiskAxisHistoryOptions,
): MacroRiskAxisHistoryV1 {
  const decisionDates = validateDecisionDates(options.decisionDates);
  validateMarketRows(marketRows);
  const states = decisionDates.map((decisionDate) => {
    const snapshot = selectMacroObservationsAsOf(macroRows, {
      seriesKeys: [...MACRO_RISK_SERIES_KEYS],
      decisionDate,
      revisionPolicy: options.revisionPolicy,
      dataCutoff: options.dataCutoff,
    });
    const marketCutoff = minimumDate(decisionDate, options.dataCutoff);
    const eligibleMarketRows = marketRows.filter((row) => row.availableDate <= marketCutoff);
    const axes = computeAxes(snapshot.observations, eligibleMarketRows);
    const values: Partial<Record<MacroRiskAxisKeyV1, number>> = {};
    const latestAvailableDates: Partial<Record<MacroRiskAxisKeyV1, string>> = {};
    for (const axis of MACRO_RISK_AXIS_KEYS_V1) {
      const value = axes[axis];
      if (value) {
        values[axis] = value.score;
        latestAvailableDates[axis] = value.availableDate;
      }
    }
    return {
      month: decisionDate.slice(0, 6),
      date: decisionDate,
      values,
      latestAvailableDates,
      seriesAvailableThrough: stateSeriesAvailability(snapshot.observations, eligibleMarketRows),
      pointInTimeEligible:
        options.revisionPolicy === 'as_available' && snapshot.disclosure.futureVintageRows === 0,
      futureVintageRows: snapshot.disclosure.futureVintageRows,
    } satisfies MacroRiskAxisStateV1;
  });
  const stateByMonth = new Map(states.map((state) => [state.month, state]));
  const observations = states.map((state): MacroRiskAxisObservationV1 => {
    const previous = stateByMonth.get(addMonths(state.month, -1));
    const values: Partial<Record<MacroRiskAxisKeyV1, number>> = {};
    if (previous) {
      for (const axis of MACRO_RISK_AXIS_KEYS_V1) {
        const currentValue = state.values[axis];
        const previousValue = previous.values[axis];
        if (currentValue != null && previousValue != null) {
          values[axis] = currentValue - previousValue;
        }
      }
    }
    return { date: state.date, values };
  });
  const outputStartDate = options.outputStartDate ?? decisionDates[0]!;
  const outputStates = states.filter((state) => state.date >= outputStartDate);
  const outputObservations = observations.filter(
    (observation) => observation.date >= outputStartDate,
  );
  const finalState = states.at(-1)!;
  const lineageSeries = Object.entries(finalState.seriesAvailableThrough).map(
    ([seriesKey, availableThrough]) => ({
      seriesKey,
      availableThrough,
      revisionPolicy: MACRO_RISK_MARKET_SERIES_KEYS.includes(
        seriesKey as (typeof MACRO_RISK_MARKET_SERIES_KEYS)[number],
      )
        ? ('not_revised' as const)
        : options.revisionPolicy,
    }),
  );

  return {
    version: 1,
    definitions: MACRO_RISK_AXIS_DEFINITIONS_V1,
    revisionPolicy: options.revisionPolicy,
    states: outputStates,
    observations: outputObservations,
    skippedDates: outputStates
      .filter((state) => MACRO_RISK_AXIS_KEYS_V1.some((axis) => state.values[axis] == null))
      .map((state) => state.date),
    lineage: {
      dataCutoff: options.dataCutoff ?? decisionDates.at(-1)!,
      pointInTimeEligible: finalState.pointInTimeEligible,
      futureVintageRows: finalState.futureVintageRows,
      series: lineageSeries,
    },
  };
}

export async function loadMacroRiskAxisHistory(
  options: {
    startDate: string;
    endDate: string;
    revisionPolicy: MacroRevisionPolicy;
    dataCutoff?: string | null;
  },
  database: Prisma = prisma,
): Promise<MacroRiskAxisHistoryV1> {
  assertDate(options.startDate, 'macro-risk start');
  assertDate(options.endDate, 'macro-risk end');
  if (options.startDate > options.endDate) {
    throw new Error('Macro-risk startDate must not exceed endDate.');
  }
  const contextStart = `${addMonths(options.startDate.slice(0, 6), -123)}01`;
  const [macroRows, nominalRows, realRows, fxRows, calendarRows] = await Promise.all([
    loadMacroVintagesThrough(database, {
      seriesKeys: [...MACRO_RISK_SERIES_KEYS],
      throughDate: options.endDate,
      revisionPolicy: options.revisionPolicy,
      dataCutoff: options.dataCutoff,
    }),
    database.yieldCurvePoint.findMany({
      where: {
        curveCode: US_NOMINAL_CURVE_CODE,
        termYears: 10,
        availableDate: { gte: contextStart, lte: options.endDate },
      },
      select: { tradeDate: true, availableDate: true, yieldPct: true },
      orderBy: { tradeDate: 'asc' },
    }),
    database.yieldCurvePoint.findMany({
      where: {
        curveCode: US_REAL_CURVE_CODE,
        termYears: 10,
        availableDate: { gte: contextStart, lte: options.endDate },
      },
      select: { tradeDate: true, availableDate: true, yieldPct: true },
      orderBy: { tradeDate: 'asc' },
    }),
    database.fxDaily.findMany({
      where: {
        tsCode: USD_CNH_CODE,
        availableDate: { gte: contextStart, lte: options.endDate },
      },
      select: { tradeDate: true, availableDate: true, bidClose: true, askClose: true },
      orderBy: { tradeDate: 'asc' },
    }),
    database.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        isOpen: 1,
        calDate: { gte: contextStart, lte: options.endDate },
      },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    }),
  ]);
  const marketRows: MacroRiskMarketObservation[] = [
    ...nominalRows.map(
      (row): MacroRiskMarketObservation => ({
        seriesKey: US_NOMINAL_CURVE_CODE as MacroRiskMarketObservation['seriesKey'],
        sourceDate: row.tradeDate,
        availableDate: row.availableDate,
        value: row.yieldPct,
      }),
    ),
    ...realRows.map(
      (row): MacroRiskMarketObservation => ({
        seriesKey: US_REAL_CURVE_CODE as MacroRiskMarketObservation['seriesKey'],
        sourceDate: row.tradeDate,
        availableDate: row.availableDate,
        value: row.yieldPct,
      }),
    ),
    ...fxRows.map(
      (row): MacroRiskMarketObservation => ({
        seriesKey: USD_CNH_CODE as MacroRiskMarketObservation['seriesKey'],
        sourceDate: row.tradeDate,
        availableDate: row.availableDate,
        value: (row.bidClose + row.askClose) / 2,
      }),
    ),
  ];
  const decisionDates = monthlyLastDates(calendarRows.map((row) => row.calDate));
  if (decisionDates.length === 0) {
    throw new Error('Macro-risk history has no SSE month-end decision dates.');
  }
  return buildMacroRiskAxisHistory(macroRows, marketRows, {
    decisionDates,
    revisionPolicy: options.revisionPolicy,
    dataCutoff: options.dataCutoff,
    outputStartDate: options.startDate,
  });
}

function computeAxes(
  macroRows: MacroObservationVintageRow[],
  marketRows: MacroRiskMarketObservation[],
): Record<MacroRiskAxisKeyV1, AxisValue | null> {
  const pmi = scorePoints(monthlyMacroPoints(macroRows, 'cn_pmi_manufacturing'));
  const cpi = scorePoints(monthlyMacroPoints(macroRows, 'cn_cpi_yoy'));
  const ppi = scorePoints(monthlyMacroPoints(macroRows, 'cn_ppi_yoy'));
  const m1 = scorePoints(monthlyMacroPoints(macroRows, 'cn_m1_yoy'));
  const m2 = scorePoints(monthlyMacroPoints(macroRows, 'cn_m2_yoy'));
  const shibor = scorePoints(monthlyMacroPoints(macroRows, 'cn_shibor_3m'));
  const financingIncrement = scorePoints(
    yearOverYearPoints(monthlyMacroPoints(macroRows, 'cn_social_financing_increment')),
  );
  const financingStock = scorePoints(
    yearOverYearPoints(monthlyMacroPoints(macroRows, 'cn_social_financing_stock')),
  );
  const nominalYield = scorePoints(monthlyMarketPoints(marketRows, US_NOMINAL_CURVE_CODE));
  const realYield = scorePoints(monthlyMarketPoints(marketRows, US_REAL_CURVE_CODE));
  const usdCnh = scorePoints(monthlyMarketPoints(marketRows, USD_CNH_CODE));

  return {
    growth: combineScores([pmi]),
    inflation: combineScores([cpi, ppi]),
    liquidity: combineScores([m1, m2, invertScore(shibor)]),
    credit: combineScores([financingIncrement, financingStock]),
    external: combineScores([nominalYield, realYield, usdCnh]),
  };
}

function monthlyMacroPoints(rows: MacroObservationVintageRow[], seriesKey: string): MonthlyPoint[] {
  const byMonth = new Map<string, MacroObservationVintageRow>();
  for (const row of rows.filter((observation) => observation.seriesKey === seriesKey)) {
    const month = row.period.slice(0, 6);
    const current = byMonth.get(month);
    if (!current || row.period > current.period) {
      byMonth.set(month, row);
    }
  }
  return [...byMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, row]) => ({ month, value: row.value, availableDate: row.availableDate }));
}

function monthlyMarketPoints(
  rows: MacroRiskMarketObservation[],
  seriesKey: MacroRiskMarketObservation['seriesKey'],
): MonthlyPoint[] {
  const byMonth = new Map<string, MacroRiskMarketObservation>();
  for (const row of rows.filter((observation) => observation.seriesKey === seriesKey)) {
    const month = row.availableDate.slice(0, 6);
    const current = byMonth.get(month);
    if (
      !current ||
      row.availableDate > current.availableDate ||
      (row.availableDate === current.availableDate && row.sourceDate > current.sourceDate)
    ) {
      byMonth.set(month, row);
    }
  }
  return [...byMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, row]) => ({ month, value: row.value, availableDate: row.availableDate }));
}

function yearOverYearPoints(points: MonthlyPoint[]): MonthlyPoint[] {
  const byMonth = new Map(points.map((point) => [point.month, point]));
  return points.flatMap((point) => {
    const previous = byMonth.get(addMonths(point.month, -12));
    if (!previous || Math.abs(previous.value) <= Number.EPSILON) {
      return [];
    }
    return [
      {
        month: point.month,
        value: (point.value / previous.value - 1) * 100,
        availableDate: point.availableDate,
      },
    ];
  });
}

function scorePoints(points: MonthlyPoint[]): ScoredPoint | null {
  if (points.length < MACRO_RISK_MINIMUM_MONTHS) {
    return null;
  }
  const latest = points.at(-1)!;
  const valueByMonth = new Map(points.map((point) => [point.month, point.value]));
  const changes = points.flatMap((point) => {
    const previous = valueByMonth.get(addMonths(point.month, -MACRO_RISK_MOMENTUM_MONTHS));
    return previous == null
      ? []
      : [{ month: point.month, value: point.value - previous, availableDate: point.availableDate }];
  });
  const levelScore = trailingZScore(points);
  const momentumScore = changes.at(-1)?.month === latest.month ? trailingZScore(changes) : null;
  if (levelScore == null || momentumScore == null) {
    return null;
  }
  return { score: (levelScore + momentumScore) / 2, availableDate: latest.availableDate };
}

function trailingZScore(points: MonthlyPoint[]): number | null {
  const values = points.slice(-MACRO_RISK_STANDARDIZATION_MONTHS).map((point) => point.value);
  if (values.length < MACRO_RISK_MINIMUM_MONTHS) {
    return null;
  }
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  const standardDeviation = Math.sqrt(variance);
  if (!Number.isFinite(standardDeviation) || standardDeviation <= Number.EPSILON) {
    return null;
  }
  const score = (values.at(-1)! - average) / standardDeviation;
  return Math.max(-MACRO_RISK_Z_SCORE_CAP, Math.min(MACRO_RISK_Z_SCORE_CAP, score));
}

function combineScores(scores: Array<ScoredPoint | null>): AxisValue | null {
  if (scores.some((score) => score == null)) {
    return null;
  }
  const complete = scores as ScoredPoint[];
  return {
    score: mean(complete.map((score) => score.score)),
    availableDate: complete
      .map((score) => score.availableDate)
      .sort()
      .at(-1)!,
  };
}

function invertScore(score: ScoredPoint | null): ScoredPoint | null {
  return score ? { ...score, score: -score.score } : null;
}

function stateSeriesAvailability(
  macroRows: MacroObservationVintageRow[],
  marketRows: MacroRiskMarketObservation[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const seriesKey of MACRO_RISK_SERIES_KEYS) {
    const availableThrough = macroRows
      .filter((row) => row.seriesKey === seriesKey)
      .map((row) => row.availableDate)
      .sort()
      .at(-1);
    if (availableThrough) {
      result[seriesKey] = availableThrough;
    }
  }
  for (const seriesKey of MACRO_RISK_MARKET_SERIES_KEYS) {
    const availableThrough = marketRows
      .filter((row) => row.seriesKey === seriesKey)
      .map((row) => row.availableDate)
      .sort()
      .at(-1);
    if (availableThrough) {
      result[seriesKey] = availableThrough;
    }
  }
  return result;
}

function monthlyLastDates(dates: string[]): string[] {
  const byMonth = new Map<string, string>();
  for (const date of dates) {
    const month = date.slice(0, 6);
    const current = byMonth.get(month);
    if (!current || date > current) {
      byMonth.set(month, date);
    }
  }
  return [...byMonth.values()].sort();
}

function validateDecisionDates(decisionDates: string[]): string[] {
  const sorted = [...decisionDates].sort();
  if (
    sorted.length === 0 ||
    new Set(sorted).size !== sorted.length ||
    new Set(sorted.map((date) => date.slice(0, 6))).size !== sorted.length ||
    sorted.some((date) => !/^\d{8}$/.test(date))
  ) {
    throw new Error('Macro-risk decision dates must be one unique YYYYMMDD value per month.');
  }
  return sorted;
}

function validateMarketRows(rows: MacroRiskMarketObservation[]): void {
  for (const row of rows) {
    if (
      !MACRO_RISK_MARKET_SERIES_KEYS.includes(row.seriesKey) ||
      !/^\d{8}$/.test(row.sourceDate) ||
      !/^\d{8}$/.test(row.availableDate) ||
      row.availableDate <= row.sourceDate ||
      !Number.isFinite(row.value)
    ) {
      throw new Error(`Invalid macro-risk market observation ${row.seriesKey} ${row.sourceDate}.`);
    }
  }
}

function addMonths(month: string, months: number): string {
  const date = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(4, 6)) - 1 + months),
  );
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function minimumDate(date: string, dataCutoff: string | null | undefined): string {
  return dataCutoff && dataCutoff < date ? dataCutoff : date;
}

function assertDate(value: string, label: string): void {
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`${label} must be YYYYMMDD.`);
  }
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
