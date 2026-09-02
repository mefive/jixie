import type {
  IndustryHeatItem,
  IndustryWeatherItem,
  IndustryWeatherSeries,
  MarketWeatherDimension,
  MarketWeatherItem,
  MarketWeatherSeries,
  MarketWeatherState,
  MarketStylePair,
  MarketStateMetric,
  MarketStateMetricSummary,
  MarketStatePoint,
  MarketStateRegime,
  MarketStateScope,
  MarketStateScopeOption,
  MarketStateSnapshot,
  MarketWeatherFrequency,
} from '@jixie/shared';
import { MARKET_STYLE_INDEX_PAIRS } from '../store/index-presets.js';

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
  limitUpCount: number;
  limitDownCount: number;
  membershipDate?: string;
}

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

export interface IndexCloseRow {
  tsCode: string;
  tradeDate: string;
  close: number;
}

export interface IndexBenchmarkMetadataRow {
  tsCode: string;
  name: string;
  bmkSource: string;
  indexType: string;
}

export interface SwIndexDailyRow {
  tsCode: string;
  tradeDate: string;
  close: number | null;
  pe: number | null;
  pb: number | null;
}

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

export interface IndexWeatherBasicRow {
  tsCode: string;
  tradeDate: string;
  peTtm: number | null;
  pb: number | null;
  source?: 'official' | 'constituents';
}

export interface IndexWeatherMetadataRow {
  tsCode: string;
  name: string;
}

export interface IndexWeatherGroupConfig {
  key: string;
  codes: readonly string[];
}

const METRICS: MarketStateMetric[] = ['activity', 'breadth', 'trend', 'crowding'];
const ACTIVITY_WINDOW = 20;

interface MarketStateSnapshotContext {
  scope?: MarketStateScope;
  scopeOptions?: MarketStateScopeOption[];
  stylePairs?: MarketStylePair[];
  swIndexRows?: SwIndexDailyRow[];
}

export function buildMarketStateSnapshot(
  marketRows: MarketIndicatorRow[],
  industryRows: IndustryIndicatorRow[],
  context: MarketStateSnapshotContext = {},
): MarketStateSnapshot | null {
  if (marketRows.length === 0) {
    return null;
  }

  const rollingPoints = buildMarketStatePoints(marketRows);
  const asOf = rollingPoints.at(-1)!.date;
  const historyStart = subtractCalendarYears(asOf, 3);
  const points = rollingPoints.filter((point) => point.date >= historyStart);
  const latest = points.at(-1)!;
  const availableStart =
    rollingPoints.find((point) => point.activity != null)?.date ?? rollingPoints[0].date;
  const summaries = Object.fromEntries(
    METRICS.map((metric) => [metric, summarizeMetric(points, metric)]),
  ) as Record<MarketStateMetric, MarketStateMetricSummary>;
  const industries = buildIndustryHeat(industryRows, context.swIndexRows ?? [], asOf, historyStart);
  const scope = context.scope ?? 'all';
  const scopeOptions = context.scopeOptions ?? [
    {
      value: scope,
      startDate: availableStart,
      endDate: asOf,
      return5Day: null,
      return20Day: latest.trend,
      return60Day: null,
      breadth: latest.breadth,
    },
  ];

  return {
    scope,
    scopeOptions,
    asOf,
    historyStart,
    availableStart,
    membershipAsOf: marketRows.at(-1)?.membershipDate ?? null,
    regime: classifyRegime(summaries.activity, summaries.breadth),
    summaries,
    latest,
    points,
    stylePairs: context.stylePairs ?? [],
    industries,
  };
}

/** Build the full descriptive point series without the UI snapshot's three-year display trim. */
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

function summarizeMetric(
  points: MarketStatePoint[],
  metric: MarketStateMetric,
): MarketStateMetricSummary {
  const value = points.at(-1)?.[metric] ?? null;
  return {
    value,
    percentile3Year:
      value == null
        ? null
        : percentileRank(
            points.map((point) => point[metric]),
            value,
          ),
  };
}

function buildIndustryHeat(
  rows: IndustryIndicatorRow[],
  swIndexRows: SwIndexDailyRow[],
  asOf: string,
  historyStart: string,
): IndustryHeatItem[] {
  const historyRows = rows.filter((row) => row.tradeDate >= historyStart && row.tradeDate <= asOf);
  const tradingDates = [...new Set(historyRows.map((row) => row.tradeDate))].sort();
  const currentItems = buildIndustryHeatAtDate(historyRows, swIndexRows, asOf);
  const fiveDayItems = buildIndustryHeatAtDate(
    historyRows,
    swIndexRows,
    tradingDates.at(Math.max(0, tradingDates.length - 6)) ?? asOf,
  );
  const twentyDayItems = buildIndustryHeatAtDate(
    historyRows,
    swIndexRows,
    tradingDates.at(Math.max(0, tradingDates.length - 21)) ?? asOf,
  );
  const fiveDayRankByCode = new Map(fiveDayItems.map((item) => [item.l1Code, item.rank]));
  const twentyDayRankByCode = new Map(twentyDayItems.map((item) => [item.l1Code, item.rank]));

  return currentItems.map((item) => ({
    ...item,
    rankChange5Day: rankChange(item.rank, fiveDayRankByCode.get(item.l1Code)),
    rankChange20Day: rankChange(item.rank, twentyDayRankByCode.get(item.l1Code)),
  }));
}

function buildIndustryHeatAtDate(
  historyRows: IndustryIndicatorRow[],
  swIndexRows: SwIndexDailyRow[],
  snapshotDate: string,
): Omit<IndustryHeatItem, 'rankChange5Day' | 'rankChange20Day'>[] {
  const snapshotRows = historyRows.filter((row) => row.tradeDate === snapshotDate);
  const officialMetricsByCode = buildSwMetricsAtDate(swIndexRows, snapshotDate);
  const snapshotTrendValues = snapshotRows.map(
    (row) => officialMetricsByCode.get(row.l1Code)?.return20Day ?? row.excessReturn20,
  );
  const snapshotBreadthValues = snapshotRows.map(industryBreadth);

  const items = snapshotRows.map((row) => {
    const officialMetrics = officialMetricsByCode.get(row.l1Code);
    const trendValue = officialMetrics?.return20Day ?? row.excessReturn20;
    const trendScore = scorePercentile(snapshotTrendValues, trendValue);
    const breadth = industryBreadth(row);
    const breadthScore = scorePercentile(snapshotBreadthValues, breadth);
    const ownActivity = historyRows
      .filter((candidate) => candidate.l1Code === row.l1Code && candidate.tradeDate <= snapshotDate)
      .map((candidate) => candidate.floatWeightedTurnoverRate);
    const activityScore = scorePercentile(ownActivity, row.floatWeightedTurnoverRate);
    const heatScore = average([trendScore, breadthScore, activityScore]) ?? 0;

    return {
      rank: 0,
      l1Code: row.l1Code,
      l1Name: row.l1Name,
      tradedCount: row.tradedCount,
      heatScore,
      trendScore: trendScore ?? 0,
      breadthScore: breadthScore ?? 0,
      activityScore: activityScore ?? 0,
      officialReturn5Day: officialMetrics?.return5Day ?? null,
      officialReturn20Day: officialMetrics?.return20Day ?? null,
      officialReturn60Day: officialMetrics?.return60Day ?? null,
      pe: officialMetrics?.pe ?? null,
      pb: officialMetrics?.pb ?? null,
      pePercentile10Year: officialMetrics?.pePercentile ?? null,
      pbPercentile10Year: officialMetrics?.pbPercentile ?? null,
      return20: row.return20,
      excessReturn20: row.excessReturn20,
      positiveReturn20Ratio: row.positiveReturn20Ratio,
      aboveMa20Ratio: row.aboveMa20Ratio,
      aboveMa60Ratio: row.aboveMa60Ratio,
      turnoverRate: row.floatWeightedTurnoverRate,
      amountShare: row.amountShare,
      topFiveAmountShare: row.topFiveAmountShare,
    };
  });

  items.sort((left, right) => right.heatScore - left.heatScore);
  return items.map((item, index) => ({ ...item, rank: index + 1 }));
}

function buildSwMetricsAtDate(
  rows: SwIndexDailyRow[],
  snapshotDate: string,
): Map<
  string,
  {
    return5Day: number | null;
    return20Day: number | null;
    return60Day: number | null;
    pe: number | null;
    pb: number | null;
    pePercentile: number | null;
    pbPercentile: number | null;
  }
> {
  const rowsByCode = new Map<string, SwIndexDailyRow[]>();
  for (const row of rows) {
    if (row.tradeDate > snapshotDate) {
      continue;
    }
    const codeRows = rowsByCode.get(row.tsCode) ?? [];
    codeRows.push(row);
    rowsByCode.set(row.tsCode, codeRows);
  }

  return new Map(
    [...rowsByCode.entries()].flatMap(([tsCode, codeRows]) => {
      codeRows.sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
      const current = codeRows.at(-1);
      if (!current || current.tradeDate !== snapshotDate) {
        return [];
      }
      const closeRows = codeRows.flatMap((row) =>
        row.close == null ? [] : [{ tsCode, tradeDate: row.tradeDate, close: row.close }],
      );

      return [
        [
          tsCode,
          {
            return5Day: trailingReturn(closeRows, 5),
            return20Day: trailingReturn(closeRows, 20),
            return60Day: trailingReturn(closeRows, 60),
            pe: current.pe,
            pb: current.pb,
            pePercentile:
              current.pe == null
                ? null
                : percentileRank(
                    codeRows.map((row) => row.pe),
                    current.pe,
                  ),
            pbPercentile:
              current.pb == null
                ? null
                : percentileRank(
                    codeRows.map((row) => row.pb),
                    current.pb,
                  ),
          },
        ] as const,
      ];
    }),
  );
}

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
    const industries = snapshotRows.map((row): IndustryWeatherItem => {
      const periodReturn = periodReturnsByCode.get(row.l1Code) ?? null;
      const trendScore = scorePercentile(trendValues, periodReturn) ?? 0;
      const breadthScore = (industryBreadth(row) ?? 0) * 100;
      const lookupKey = `${row.l1Code}:${boundary.snapshotDate}`;
      const activityScore = (activityPercentiles.get(lookupKey) ?? 0) * 100;
      const valuationPercentile = average([
        pePercentiles.get(lookupKey) ?? null,
        pbPercentiles.get(lookupKey) ?? null,
      ]);
      const heatScore = average([trendScore, breadthScore, activityScore]) ?? 0;
      const previousHeat = previousHeatByCode.get(row.l1Code);
      const heatChange = previousHeat == null ? null : heatScore - previousHeat;
      previousHeatByCode.set(row.l1Code, heatScore);

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

    industries.sort((left, right) => right.heatScore - left.heatScore);
    return { ...boundary, industries };
  });

  return {
    frequency,
    startDate: periods[0].startDate,
    endDate: periods.at(-1)!.endDate,
    periods,
  };
}

export function toUnifiedIndustryWeatherSeries(
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
        coverage: 'full',
      })),
    })),
  };
}

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
      const heatScore = average([trendScore, normalizedBreadth, activityScore]) ?? 0;
      const previousHeat = previousHeatByCode.get(code);
      const heatChange = previousHeat == null ? null : heatScore - previousHeat;
      previousHeatByCode.set(code, heatScore);
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

function rankChange(currentRank: number, previousRank: number | undefined): number | null {
  return previousRank == null ? null : previousRank - currentRank;
}

export function buildIndexTrailingReturns(
  rows: IndexCloseRow[],
): Map<string, Pick<MarketStateScopeOption, 'return5Day' | 'return20Day' | 'return60Day'>> {
  const rowsByCode = new Map<string, IndexCloseRow[]>();
  for (const row of rows) {
    const codeRows = rowsByCode.get(row.tsCode) ?? [];
    codeRows.push(row);
    rowsByCode.set(row.tsCode, codeRows);
  }

  return new Map(
    [...rowsByCode.entries()].map(([tsCode, codeRows]) => {
      codeRows.sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
      return [
        tsCode,
        {
          return5Day: trailingReturn(codeRows, 5),
          return20Day: trailingReturn(codeRows, 20),
          return60Day: trailingReturn(codeRows, 60),
        },
      ];
    }),
  );
}

export function buildMarketStylePairs(
  closeRows: IndexCloseRow[],
  metadataRows: IndexBenchmarkMetadataRow[],
): MarketStylePair[] {
  const metadataByCode = new Map(
    metadataRows.filter((row) => row.indexType === '风格类指数').map((row) => [row.tsCode, row]),
  );
  const trailingReturnsByCode = buildIndexTrailingReturns(closeRows);

  return MARKET_STYLE_INDEX_PAIRS.flatMap((pair) => {
    const growthMetadata = metadataByCode.get(pair.growth);
    const valueMetadata = metadataByCode.get(pair.value);
    const growthReturns = trailingReturnsByCode.get(pair.growth);
    const valueReturns = trailingReturnsByCode.get(pair.value);
    if (!growthMetadata || !valueMetadata || !growthReturns || !valueReturns) {
      return [];
    }

    return [
      {
        key: pair.key,
        growth: {
          tsCode: pair.growth,
          name: growthMetadata.name,
          source: growthMetadata.bmkSource,
          ...growthReturns,
        },
        value: {
          tsCode: pair.value,
          name: valueMetadata.name,
          source: valueMetadata.bmkSource,
          ...valueReturns,
        },
        spread5Day: difference(growthReturns.return5Day, valueReturns.return5Day),
        spread20Day: difference(growthReturns.return20Day, valueReturns.return20Day),
        spread60Day: difference(growthReturns.return60Day, valueReturns.return60Day),
      },
    ];
  });
}

function trailingReturn(rows: IndexCloseRow[], tradingDays: number): number | null {
  if (rows.length <= tradingDays) {
    return null;
  }

  const currentClose = rows.at(-1)!.close;
  const previousClose = rows.at(-(tradingDays + 1))!.close;
  return previousClose === 0 ? null : currentClose / previousClose - 1;
}

function difference(left: number | null, right: number | null): number | null {
  return left == null || right == null ? null : left - right;
}

function industryBreadth(row: IndustryIndicatorRow): number | null {
  return average([row.positiveReturn20Ratio, row.aboveMa20Ratio, row.aboveMa60Ratio]);
}

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

function classifyRegime(
  activity: MarketStateMetricSummary,
  breadth: MarketStateMetricSummary,
): MarketStateRegime {
  if (activity.percentile3Year == null || breadth.value == null) {
    return 'balanced';
  }
  if (activity.percentile3Year >= 2 / 3 && breadth.value >= 0.55) {
    return 'hotBroad';
  }
  if (activity.percentile3Year >= 2 / 3 && breadth.value <= 0.45) {
    return 'hotNarrow';
  }
  if (activity.percentile3Year <= 1 / 3 && breadth.value >= 0.55) {
    return 'coldBroad';
  }
  if (activity.percentile3Year <= 1 / 3 && breadth.value <= 0.45) {
    return 'coldWeak';
  }
  return 'balanced';
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
