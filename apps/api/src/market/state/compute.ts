import type {
  IndustryWeatherItem,
  IndustryWeatherSeries,
  MarketStatePoint,
  MarketWeatherDimension,
  MarketWeatherFrequency,
  MarketWeatherItem,
  MarketWeatherSeries,
  MarketWeatherState,
} from '@jixie/shared';

/**
 * 提供已计算全市场指标，供状态和气象派生。
 *
 * Supply computed market indicators for state and weather derivation.
 */
export interface MarketIndicatorRow {
  tradeDate: string;
  tradedCount: number;
  return20: number | null;
  advanceRatio: number | null;
  aboveMa20Ratio: number | null;
  aboveMa60Ratio: number | null;
  totalAmount: number | null;
  floatWeightedTurnoverRate: number | null;
  topFivePercentAmountShare: number | null;
  extremeMoveRatio: number | null;
  limitUpCount: number | null;
  limitDownCount: number | null;
  membershipDate?: string;
}

/**
 * 提供行业指标与日期，供行业气象聚合。
 *
 * Supply dated industry indicators for weather aggregation.
 */
export interface IndustryIndicatorRow {
  l1Code: string;
  l1Name: string;
  tradeDate: string;
  tradedCount: number;
  return20: number | null;
  excessReturn20: number | null;
  positiveReturn20Ratio: number | null;
  aboveMa20Ratio: number | null;
  aboveMa60Ratio: number | null;
  floatWeightedTurnoverRate: number | null;
  amountShare: number | null;
  topFiveAmountShare: number | null;
}

/**
 * 提供指数日期与收盘，供状态收益计算。
 *
 * Supply dated index closes for state return calculation.
 */
export interface IndexCloseRow {
  tsCode: string;
  tradeDate: string;
  close: number;
}

/**
 * 提供申万一级行业日线，供行业基准收益。
 *
 * Supply Shenwan industry bars for benchmark returns.
 */
export interface SwIndexDailyRow {
  tsCode: string;
  tradeDate: string;
  close: number | null;
  pe: number | null;
  pb: number | null;
}

/**
 * 提供指数气象所需指标历史。
 *
 * Supply index indicator history for weather computation.
 */
export interface IndexWeatherIndicatorRow {
  indexCode: string;
  tradeDate: string;
  return20: number | null;
  aboveMa20Ratio: number | null;
  aboveMa60Ratio: number | null;
  floatWeightedTurnoverRate: number | null;
  peTtm?: number | null;
  pb?: number | null;
  valuationCoverage?: number | null;
}

/**
 * 提供指数估值与换手等基础指标，供气象解释。
 *
 * Supply index valuations and activity for weather interpretation.
 */
export interface IndexWeatherBasicRow {
  tsCode: string;
  tradeDate: string;
  peTtm: number | null;
  pb: number | null;
  source?: 'official' | 'constituents';
}

/**
 * 保留指数分类及显示身份，供气象分组。
 *
 * Supply index metadata for weather grouping.
 */
export interface IndexWeatherMetadataRow {
  tsCode: string;
  name: string;
}

/**
 * 配置指数气象组与成员，供统一看板组织。
 *
 * Configure index weather groups and members.
 */
export interface IndexWeatherGroupConfig {
  key: string;
  codes: readonly string[];
}
const ACTIVITY_WINDOW = 20;

/**
 * 构建完整描述性市场状态序列，供 Research 数据集读取。
 *
 * Build the full descriptive point series for Research datasets.
 */
export function buildMarketStatePoints(marketRows: MarketIndicatorRow[]): MarketStatePoint[] {
  return marketRows.map((row, index) =>
    toPoint(row, rollingAverage(marketRows, index, 'floatWeightedTurnoverRate', ACTIVITY_WINDOW)),
  );
}

function toPoint(row: MarketIndicatorRow, activity: number | null): MarketStatePoint {
  return {
    date: row.tradeDate,
    activity,
    breadth: average([row.aboveMa20Ratio, row.aboveMa60Ratio]),
    trend: row.return20,
    crowding: row.topFivePercentAmountShare,
    advanceRatio: row.advanceRatio,
    aboveMa20Ratio: row.aboveMa20Ratio,
    aboveMa60Ratio: row.aboveMa60Ratio,
    totalAmount: row.totalAmount,
    extremeMoveRatio: row.extremeMoveRatio,
    limitUpCount: row.limitUpCount,
    limitDownCount: row.limitDownCount,
    tradedCount: row.tradedCount,
  };
}

/**
 * 按行业聚合状态指标与收益，生成各周期行业气象。
 *
 * Aggregate industry indicators and returns into period-specific industry weather.
 */
export function buildIndustryWeatherSeries(
  industryRows: IndustryIndicatorRow[],
  swIndexRows: SwIndexDailyRow[],
  frequency: MarketWeatherFrequency,
): IndustryWeatherSeries | null {
  const swRowByCodeAndDate = new Map(
    swIndexRows.map((row) => [`${row.tsCode}:${row.tradeDate}`, row]),
  );
  const availableDates = [
    ...new Set(
      industryRows.flatMap((row) =>
        swRowByCodeAndDate.has(`${row.l1Code}:${row.tradeDate}`) ? [row.tradeDate] : [],
      ),
    ),
  ].sort();
  const periodBoundaries = buildWeatherPeriodBoundaries(availableDates, frequency);
  if (periodBoundaries.length === 0) {
    return null;
  }

  const industryRowsByDate = groupRows(industryRows, (row) => row.tradeDate);
  const snapshotDates = new Set(periodBoundaries.map((boundary) => boundary.snapshotDate));
  const activityPercentiles = buildRollingPercentileLookup(
    industryRows,
    (row) => row.l1Code,
    (row) => row.floatWeightedTurnoverRate,
    3,
    snapshotDates,
  );
  const pePercentiles = buildRollingPercentileLookup(
    swIndexRows,
    (row) => row.tsCode,
    (row) => row.pe,
    10,
    snapshotDates,
  );
  const pbPercentiles = buildRollingPercentileLookup(
    swIndexRows,
    (row) => row.tsCode,
    (row) => row.pb,
    10,
    snapshotDates,
  );
  const previousHeatByCode = new Map<string, number>();

  /**
   * 按周期边界对齐行业快照和前期价格，生成周期行业气象。
   *
   * Align industry snapshots and prior prices for period weather.
   */
  const periods = periodBoundaries.map((boundary, periodIndex) => {
    const snapshotRows = industryRowsByDate.get(boundary.snapshotDate) ?? [];
    const previousSnapshotDate =
      periodIndex > 0 ? periodBoundaries[periodIndex - 1].snapshotDate : undefined;
    const periodReturnsByCode = new Map(
      snapshotRows.map((row) => {
        const currentClose = swRowByCodeAndDate.get(
          `${row.l1Code}:${boundary.snapshotDate}`,
        )?.close;
        const previousClose = previousSnapshotDate
          ? swRowByCodeAndDate.get(`${row.l1Code}:${previousSnapshotDate}`)?.close
          : null;
        const periodReturn =
          currentClose == null || previousClose == null || previousClose === 0
            ? null
            : currentClose / previousClose - 1;
        return [row.l1Code, periodReturn] as const;
      }),
    );
    const trendValues = snapshotRows.map((row) => periodReturnsByCode.get(row.l1Code) ?? null);

    /**
     * 从收益、广度、活跃度和估值构造单行业气象项。
     *
     * Build industry weather from returns, breadth, activity and valuation.
     */
    const industries = snapshotRows.map((row): IndustryWeatherItem => {
      const periodReturn = periodReturnsByCode.get(row.l1Code) ?? null;
      const trendScore = scorePercentile(trendValues, periodReturn);
      const rawBreadth = industryBreadth(row);
      const breadthScore = rawBreadth == null ? null : rawBreadth * 100;
      const lookupKey = `${row.l1Code}:${boundary.snapshotDate}`;
      const rawActivity = activityPercentiles.get(lookupKey);
      const activityScore = rawActivity == null ? null : rawActivity * 100;
      const valuationPercentile = average([
        pePercentiles.get(lookupKey) ?? null,
        pbPercentiles.get(lookupKey) ?? null,
      ]);
      const heatScore =
        trendScore == null || breadthScore == null || activityScore == null
          ? null
          : average([trendScore, breadthScore, activityScore]);
      const previousHeat = previousHeatByCode.get(row.l1Code);
      const heatChange =
        previousHeat == null || heatScore == null ? null : heatScore - previousHeat;
      if (heatScore != null) {
        previousHeatByCode.set(row.l1Code, heatScore);
      }

      return {
        l1Code: row.l1Code,
        l1Name: row.l1Name,
        periodReturn,
        heatScore,
        heatChange,
        activityScore,
        breadthScore,
        valuationPercentile: valuationPercentile == null ? null : valuationPercentile * 100,
        state: classifyIndustryWeather({
          periodReturn,
          heatScore,
          heatChange,
          activityScore,
          breadthScore,
          valuationPercentile: valuationPercentile == null ? null : valuationPercentile * 100,
        }),
      };
    });

    industries.sort(
      (left, right) => (right.heatScore ?? -Infinity) - (left.heatScore ?? -Infinity),
    );
    return { ...boundary, industries };
  });

  return {
    frequency,
    startDate: periods[0].startDate,
    endDate: periods.at(-1)!.endDate,
    periods,
  };
}

/**
 * 将行业气象映射为通用市场气象展示结构。
 *
 * Map industry weather into the common market-weather response.
 */
export function industryWeatherToMarketWeather(
  series: IndustryWeatherSeries,
  groups: readonly IndexWeatherGroupConfig[],
): MarketWeatherSeries {
  return {
    dimension: 'industry',
    frequency: series.frequency,
    startDate: series.startDate,
    endDate: series.endDate,
    groups: groups.map((group) => ({ key: group.key, codes: [...group.codes] })),
    periods: series.periods.map((period) => ({
      key: period.key,
      startDate: period.startDate,
      endDate: period.endDate,
      snapshotDate: period.snapshotDate,
      items: period.industries.map((industry) => ({
        code: industry.l1Code,
        name: industry.l1Name,
        periodReturn: industry.periodReturn,
        benchmarkCode: null,
        benchmarkName: null,
        relativeReturn: null,
        heatScore: industry.heatScore,
        heatChange: industry.heatChange,
        activityScore: industry.activityScore,
        breadthScore: industry.breadthScore,
        valuationPercentile: industry.valuationPercentile,
        valuationSource: industry.valuationPercentile == null ? null : 'official',
        state: industry.state,
        coverage: industry.heatScore == null ? 'partial' : 'full',
      })),
    })),
  };
}

/**
 * 按指数与周期聚合状态、估值和行情，生成指数气象。
 *
 * Aggregate index state, valuation and prices into period-specific weather.
 */
export function buildIndexWeatherSeries(
  dimension: Exclude<MarketWeatherDimension, 'industry'>,
  groups: readonly IndexWeatherGroupConfig[],
  closeRows: IndexCloseRow[],
  indicatorRows: IndexWeatherIndicatorRow[],
  basicRows: IndexWeatherBasicRow[],
  metadataRows: IndexWeatherMetadataRow[],
  frequency: MarketWeatherFrequency,
  benchmarks: Readonly<Record<string, string>> = {},
): MarketWeatherSeries | null {
  const configuredCodes = groups.flatMap((group) => [...group.codes]);
  const metadataByCode = new Map(metadataRows.map((row) => [row.tsCode, row]));
  const basicByCodeAndDate = new Map(
    basicRows.map((row) => [`${row.tsCode}:${row.tradeDate}`, row]),
  );
  const closeByCodeAndDate = new Map(
    closeRows.map((row) => [`${row.tsCode}:${row.tradeDate}`, row.close]),
  );
  const closeCodes = [...new Set(closeRows.map((row) => row.tsCode))];
  const indicatorEndDate = indicatorRows.reduce(
    (latest, row) => (row.tradeDate > latest ? row.tradeDate : latest),
    '',
  );
  const availableDates = [
    ...new Set(
      closeRows.flatMap((row) =>
        !indicatorEndDate || row.tradeDate <= indicatorEndDate ? [row.tradeDate] : [],
      ),
    ),
  ].sort();
  const periodBoundaries = buildWeatherPeriodBoundaries(availableDates, frequency);
  if (periodBoundaries.length === 0) {
    return null;
  }

  const indicatorByCodeAndDate = new Map(
    indicatorRows.map((row) => [`${row.indexCode}:${row.tradeDate}`, row]),
  );
  const snapshotDates = new Set(periodBoundaries.map((boundary) => boundary.snapshotDate));
  const activityPercentiles = buildRollingPercentileLookup(
    indicatorRows,
    (row) => row.indexCode,
    (row) => row.floatWeightedTurnoverRate,
    3,
    snapshotDates,
  );
  const pePercentiles = buildRollingPercentileLookup(
    basicRows,
    (row) => row.tsCode,
    (row) => row.peTtm,
    10,
    snapshotDates,
  );
  const pbPercentiles = buildRollingPercentileLookup(
    basicRows,
    (row) => row.tsCode,
    (row) => row.pb,
    10,
    snapshotDates,
  );
  const previousHeatByCode = new Map<string, number>();

  /**
   * 按周期对齐指数收盘及基准，生成指数气象。
   *
   * Align index and benchmark closes for period weather.
   */
  const periods = periodBoundaries.map((boundary, periodIndex) => {
    const previousSnapshotDate =
      periodIndex > 0 ? periodBoundaries[periodIndex - 1].snapshotDate : undefined;
    const periodReturnByCode = new Map(
      closeCodes.map((code) => {
        const currentClose = closeByCodeAndDate.get(`${code}:${boundary.snapshotDate}`);
        const previousClose = previousSnapshotDate
          ? closeByCodeAndDate.get(`${code}:${previousSnapshotDate}`)
          : null;
        const periodReturn =
          currentClose == null || previousClose == null || previousClose === 0
            ? null
            : currentClose / previousClose - 1;
        return [code, periodReturn] as const;
      }),
    );
    const relativeReturnByCode = new Map(
      configuredCodes.map((code) => {
        const benchmarkCode = benchmarks[code];
        const periodReturn = periodReturnByCode.get(code) ?? null;
        const benchmarkReturn = benchmarkCode
          ? (periodReturnByCode.get(benchmarkCode) ?? null)
          : null;
        const relativeReturn =
          periodReturn == null || benchmarkReturn == null || benchmarkReturn === -1
            ? null
            : (1 + periodReturn) / (1 + benchmarkReturn) - 1;
        return [code, relativeReturn] as const;
      }),
    );
    const trendValues = configuredCodes.map(
      (code) => relativeReturnByCode.get(code) ?? periodReturnByCode.get(code) ?? null,
    );

    /**
     * 对有当期收盘的指数计算气象指标，缺行情不生成虚假项目。
     *
     * Build index weather only where a current close exists.
     */
    const items = configuredCodes.flatMap((code): MarketWeatherItem[] => {
      const currentClose = closeByCodeAndDate.get(`${code}:${boundary.snapshotDate}`);
      if (currentClose == null) {
        return [];
      }

      const periodReturn = periodReturnByCode.get(code) ?? null;
      const benchmarkCode = benchmarks[code] ?? null;
      const relativeReturn = relativeReturnByCode.get(code) ?? null;
      const trendScore = scorePercentile(trendValues, relativeReturn ?? periodReturn);
      const lookupKey = `${code}:${boundary.snapshotDate}`;
      const indicator = indicatorByCodeAndDate.get(lookupKey);
      const breadthScore = average([
        indicator?.aboveMa20Ratio ?? null,
        indicator?.aboveMa60Ratio ?? null,
      ]);
      const activityPercentile = activityPercentiles.get(lookupKey);
      const valuationPercentile = average([
        pePercentiles.get(lookupKey) ?? null,
        pbPercentiles.get(lookupKey) ?? null,
      ]);
      const activityScore = activityPercentile == null ? null : activityPercentile * 100;
      const normalizedBreadth = breadthScore == null ? null : breadthScore * 100;
      const normalizedValuation = valuationPercentile == null ? null : valuationPercentile * 100;
      const heatScore =
        trendScore == null || normalizedBreadth == null || activityScore == null
          ? null
          : average([trendScore, normalizedBreadth, activityScore]);
      const previousHeat = previousHeatByCode.get(code);
      const heatChange =
        previousHeat == null || heatScore == null ? null : heatScore - previousHeat;
      if (heatScore != null) {
        previousHeatByCode.set(code, heatScore);
      }
      const item = {
        code,
        name: metadataByCode.get(code)?.name ?? code,
        periodReturn,
        benchmarkCode,
        benchmarkName: benchmarkCode
          ? (metadataByCode.get(benchmarkCode)?.name ?? benchmarkCode)
          : null,
        relativeReturn,
        heatScore,
        heatChange,
        activityScore,
        breadthScore: normalizedBreadth,
        valuationPercentile: normalizedValuation,
        valuationSource:
          normalizedValuation == null
            ? null
            : (basicByCodeAndDate.get(lookupKey)?.source ?? 'official'),
        coverage:
          activityScore != null && normalizedBreadth != null && normalizedValuation != null
            ? 'full'
            : 'partial',
      } as const;

      return [{ ...item, state: classifyMarketWeather(item) }];
    });

    return { ...boundary, items };
  });

  return {
    dimension,
    frequency,
    startDate: periods[0].startDate,
    endDate: periods.at(-1)!.endDate,
    groups: groups.map((group) => ({ key: group.key, codes: [...group.codes] })),
    periods,
  };
}

function classifyIndustryWeather(
  item: Pick<
    IndustryWeatherItem,
    | 'periodReturn'
    | 'heatScore'
    | 'heatChange'
    | 'activityScore'
    | 'breadthScore'
    | 'valuationPercentile'
  >,
): IndustryWeatherItem['state'] {
  return classifyMarketWeather(item);
}

/**
 * 按现有指标阈值划分描述性市场气象，不生成交易建议。
 *
 * Classify descriptive market weather from the implemented indicator thresholds.
 */
function classifyMarketWeather(
  item: Pick<
    MarketWeatherItem,
    | 'periodReturn'
    | 'heatScore'
    | 'heatChange'
    | 'activityScore'
    | 'breadthScore'
    | 'valuationPercentile'
  >,
): MarketWeatherState {
  if (item.heatScore == null) {
    return 'waiting';
  }
  if (
    item.periodReturn != null &&
    item.periodReturn < 0 &&
    item.heatChange != null &&
    item.heatChange <= -8
  ) {
    return 'cooling';
  }
  if (
    item.valuationPercentile != null &&
    item.valuationPercentile >= 70 &&
    item.heatScore >= 75 &&
    item.activityScore != null &&
    item.activityScore >= 75
  ) {
    return 'crowded';
  }
  if (
    item.periodReturn != null &&
    item.periodReturn > 0 &&
    item.heatScore >= 85 &&
    item.activityScore != null &&
    item.activityScore >= 80
  ) {
    return 'overheated';
  }
  if (
    item.periodReturn != null &&
    item.periodReturn > 0 &&
    item.heatScore >= 68 &&
    item.breadthScore != null &&
    item.breadthScore >= 60
  ) {
    return 'expanding';
  }
  if (
    item.periodReturn != null &&
    item.periodReturn > 0 &&
    item.heatChange != null &&
    item.heatChange >= 7
  ) {
    return 'warming';
  }
  if (item.valuationPercentile != null && item.valuationPercentile <= 30 && item.heatScore < 65) {
    return 'undervalued';
  }
  return 'balanced';
}

/**
 * 从交易日序列构造周月等周期边界，供气象聚合。
 *
 * Build period boundaries from trading dates for weather aggregation.
 */
function buildWeatherPeriodBoundaries(
  tradeDates: string[],
  frequency: MarketWeatherFrequency,
): Array<{
  key: string;
  startDate: string;
  endDate: string;
  snapshotDate: string;
}> {
  const boundariesByKey = new Map<
    string,
    { key: string; startDate: string; endDate: string; snapshotDate: string }
  >();
  for (const tradeDate of tradeDates) {
    const key = weatherPeriodKey(tradeDate, frequency);
    const current = boundariesByKey.get(key);
    if (current) {
      current.endDate = tradeDate;
      current.snapshotDate = tradeDate;
    } else {
      boundariesByKey.set(key, {
        key,
        startDate: tradeDate,
        endDate: tradeDate,
        snapshotDate: tradeDate,
      });
    }
  }
  return [...boundariesByKey.values()];
}

/**
 * 将日期映射为气象周期键，供相同周期聚合。
 *
 * Map a date to its weather aggregation period key.
 */
function weatherPeriodKey(tradeDate: string, frequency: MarketWeatherFrequency): string {
  const year = tradeDate.slice(0, 4);
  const month = Number(tradeDate.slice(4, 6));
  switch (frequency) {
    case 'week':
      return isoWeekKey(tradeDate);
    case 'month':
      return `${year}-${String(month).padStart(2, '0')}`;
    case 'quarter':
      return `${year}-Q${Math.ceil(month / 3)}`;
    case 'year':
      return year;
  }
}

/**
 * 将日期归入 ISO 周一，供市场周期边界。
 *
 * Map a date to its ISO Monday for market periods.
 */
function isoWeekKey(tradeDate: string): string {
  const date = new Date(
    Date.UTC(
      Number(tradeDate.slice(0, 4)),
      Number(tradeDate.slice(4, 6)) - 1,
      Number(tradeDate.slice(6, 8)),
    ),
  );
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNumber = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${weekYear}-W${String(weekNumber).padStart(2, '0')}`;
}

function groupRows<Row>(rows: Row[], key: (row: Row) => string): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const rowKey = key(row);
    const group = grouped.get(rowKey) ?? [];
    group.push(row);
    grouped.set(rowKey, group);
  }
  return grouped;
}

/**
 * 按历史窗口建立分位查询，供状态指标描述当前位置。
 *
 * Build historical percentile lookups for descriptive state indicators.
 */
function buildRollingPercentileLookup<Row extends { tradeDate: string }>(
  rows: Row[],
  code: (row: Row) => string,
  value: (row: Row) => number | null,
  years: number,
  snapshotDates: Set<string>,
): Map<string, number> {
  const result = new Map<string, number>();
  const rowsByCode = groupRows(rows, code);
  for (const [rowCode, codeRows] of rowsByCode) {
    codeRows.sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
    const sortedWindow: number[] = [];
    let windowStartIndex = 0;

    for (const row of codeRows) {
      const windowStartDate = subtractCalendarYears(row.tradeDate, years);
      while (
        windowStartIndex < codeRows.length &&
        codeRows[windowStartIndex].tradeDate < windowStartDate
      ) {
        const expiredValue = value(codeRows[windowStartIndex]);
        if (expiredValue != null && Number.isFinite(expiredValue)) {
          removeSorted(sortedWindow, expiredValue);
        }
        windowStartIndex += 1;
      }

      const current = value(row);
      if (current != null && Number.isFinite(current)) {
        insertSorted(sortedWindow, current);
        if (snapshotDates.has(row.tradeDate)) {
          result.set(
            `${rowCode}:${row.tradeDate}`,
            upperBound(sortedWindow, current) / sortedWindow.length,
          );
        }
      }
    }
  }
  return result;
}

function insertSorted(values: number[], value: number): void {
  values.splice(lowerBound(values, value), 0, value);
}

function removeSorted(values: number[], value: number): void {
  const index = lowerBound(values, value);
  if (values[index] === value) {
    values.splice(index, 1);
  }
}

/**
 * 二分定位首个不小于目标的历史值，供分位统计。
 *
 * Find the first sorted historical value not below a target.
 */
function lowerBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * 二分定位首个大于目标的历史值，供并列分位处理。
 *
 * Find the first sorted historical value above a target.
 */
function upperBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] <= target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function industryBreadth(row: IndustryIndicatorRow): number | null {
  return average([row.positiveReturn20Ratio, row.aboveMa20Ratio, row.aboveMa60Ratio]);
}

/**
 * 在固定窗口滚动计算均值，供市场活跃度指标。
 *
 * Compute fixed-window rolling averages for market activity.
 */
function rollingAverage(
  rows: MarketIndicatorRow[],
  index: number,
  field: 'floatWeightedTurnoverRate',
  window: number,
): number | null {
  if (index + 1 < window) {
    return null;
  }

  return average(rows.slice(index - window + 1, index + 1).map((row) => row[field]));
}

function scorePercentile(values: Array<number | null>, current: number | null): number | null {
  const percentile = current == null ? null : percentileRank(values, current);
  return percentile == null ? null : percentile * 100;
}

function percentileRank(values: Array<number | null>, current: number): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (valid.length === 0) {
    return null;
  }
  return valid.filter((value) => value <= current).length / valid.length;
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  return valid.length === 0
    ? null
    : valid.reduce((total, value) => total + value, 0) / valid.length;
}

function subtractCalendarYears(date: string, years: number): string {
  return `${Number(date.slice(0, 4)) - years}${date.slice(4)}`;
}
