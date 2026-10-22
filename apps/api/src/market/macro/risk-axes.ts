import {
  MACRO_RISK_AXIS_KEYS_V1,
  type MacroRiskAxisDefinitionV1,
  type MacroRiskAxisKeyV1,
  type RiskDataLineageV1,
} from '@jixie/shared';
import { getDatabase, type Prisma } from '#infra/database/prisma.js';
import {
  loadMacroVintagesThrough,
  selectMacroObservationsAsOf,
  type MacroObservationVintageRow,
  type MacroRevisionPolicy,
} from './as-of.js';
import { US_NOMINAL_CURVE_CODE, US_REAL_CURVE_CODE } from '../registry/yield-curves.js';
import { USD_CNH_CODE } from '../registry/fx.js';

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

/**
 * 提供市场观测作为宏观风险轴输入。
 *
 * Supply market observations used by macro risk axes.
 */
export interface MacroRiskMarketObservation {
  seriesKey: (typeof MACRO_RISK_MARKET_SERIES_KEYS)[number];
  sourceDate: string;
  availableDate: string;
  value: number;
}

/**
 * 保存五轴状态分数、可得日期和诊断。
 *
 * Retain five-axis scores, availability and diagnostics.
 */
export interface MacroRiskAxisStateV1 {
  month: string;
  date: string;
  values: Partial<Record<MacroRiskAxisKeyV1, number>>;
  latestAvailableDates: Partial<Record<MacroRiskAxisKeyV1, string>>;
  seriesAvailableThrough: Record<string, string>;
  pointInTimeEligible: boolean;
  futureVintageRows: number;
}

/**
 * 记录风险轴相邻状态变化，供月度敏感度模型。
 *
 * Describe risk-axis state changes for monthly sensitivity models.
 */
export interface MacroRiskAxisObservationV1 {
  date: string;
  values: Partial<Record<MacroRiskAxisKeyV1, number>>;
}

/**
 * 汇总风险轴水平、变化与来源血缘。
 *
 * Collect risk-axis levels, changes and lineage.
 */
export interface MacroRiskAxisHistoryV1 {
  version: 1;
  definitions: readonly MacroRiskAxisDefinitionV1[];
  revisionPolicy: MacroRevisionPolicy;
  states: MacroRiskAxisStateV1[];
  observations: MacroRiskAxisObservationV1[];
  skippedDates: string[];
  lineage: RiskDataLineageV1;
}

/**
 * 配置风险轴历史的日期、样本和输入要求。
 *
 * Configure dates, sample and input requirements for risk-axis history.
 */
export interface BuildMacroRiskAxisHistoryOptions {
  decisionDates: string[];
  revisionPolicy: MacroRevisionPolicy;
  dataCutoff?: string | null;
  outputStartDate?: string | null;
}

/**
 * 按自然月组织指标水平，供轴评分对齐。
 *
 * Supply monthly levels for aligned axis scoring.
 */
interface MonthlyPoint {
  month: string;
  value: number;
  availableDate: string;
}

/**
 * 将月度数值与标准化评分绑定，供风险轴组合。
 *
 * Associate monthly values and standardized scores for axis construction.
 */
interface ScoredPoint {
  score: number;
  availableDate: string;
}

/**
 * 保留单风险轴的数值与可用性，供状态汇总。
 *
 * Retain an axis value and its availability for state assembly.
 */
interface AxisValue {
  score: number;
  availableDate: string;
}

/**
 * 构造透明的五轴宏观状态及其月度分数变化。
 *
 * Builds transparent five-axis macro states and their month-over-month score changes.
 */
export function buildMacroRiskAxisHistory(
  macroRows: MacroObservationVintageRow[],
  marketRows: MacroRiskMarketObservation[],
  options: BuildMacroRiskAxisHistoryOptions,
): MacroRiskAxisHistoryV1 {
  const decisionDates = validateDecisionDates(options.decisionDates);
  validateMarketRows(marketRows);

  /**
   * 逐决策日筛选可得宏观与市场输入，再计算风险轴状态。
   *
   * Select available macro and market inputs and compute each decision-date axis state.
   */
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

  /**
   * 对相邻自然月的同轴状态求变化，缺失月份不跨期伪配。
   *
   * Compute same-axis changes between consecutive calendar months without bridging missing months.
   */
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

/**
 * 加载宏观和市场输入后构造风险轴历史，供风险研究共用。
 *
 * Load macro and market inputs and construct risk-axis history for risk research.
 */
export async function loadMacroRiskAxisHistory(
  options: {
    startDate: string;
    endDate: string;
    revisionPolicy: MacroRevisionPolicy;
    dataCutoff?: string | null;
  },
  database: Prisma = getDatabase(),
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

/**
 * 按声明的序列组合计算宏观五轴，保留不可计算状态。
 *
 * Compute the declared macro axes while preserving unavailable states.
 */
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

/**
 * 将宏观观测按自然月组织，保持可得性选择。
 *
 * Group available macro observations into monthly points.
 */
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

/**
 * 将可得市场水平映射为月末点，供风险轴对齐。
 *
 * Map available market levels to month-end points for axis alignment.
 */
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

/**
 * 按历史窗口标准化序列点，供风险轴可比评分。
 *
 * Standardize historical series points for comparable risk-axis scores.
 */
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

/**
 * 由尾部样本均值和离散度计算风险轴标准分。
 *
 * Standardize risk-axis observations using trailing moments.
 */
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

/**
 * 汇总状态所依赖序列的可得日期，供严格时点对齐。
 *
 * Resolve the availability of source series contributing to a state.
 */
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

/**
 * 校验市场输入日期、可得日期和有限值，供风险轴构造。
 *
 * Validate dates, availability and finite market inputs before axis construction.
 */
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

/**
 * 按自然月偏移日期，供风险轴相邻月比较。
 *
 * Shift dates by calendar months for adjacent-axis comparison.
 */
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
