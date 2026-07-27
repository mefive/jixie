import type {
  IndustryHeatItem,
  MarketStateMetric,
  MarketStateMetricSummary,
  MarketStatePoint,
  MarketStateRegime,
  MarketStateScope,
  MarketStateScopeOption,
  MarketStateSnapshot,
} from '@jixie/shared';

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

const METRICS: MarketStateMetric[] = ['activity', 'breadth', 'trend', 'crowding'];
const ACTIVITY_WINDOW = 20;

interface MarketStateSnapshotContext {
  scope?: MarketStateScope;
  scopeOptions?: MarketStateScopeOption[];
}

export function buildMarketStateSnapshot(
  marketRows: MarketIndicatorRow[],
  industryRows: IndustryIndicatorRow[],
  context: MarketStateSnapshotContext = {},
): MarketStateSnapshot | null {
  if (marketRows.length === 0) {
    return null;
  }

  const rollingPoints = marketRows.map((row, index) =>
    toPoint(row, rollingAverage(marketRows, index, 'floatWeightedTurnoverRate', ACTIVITY_WINDOW)),
  );
  const asOf = rollingPoints.at(-1)!.date;
  const historyStart = subtractCalendarYears(asOf, 3);
  const points = rollingPoints.filter((point) => point.date >= historyStart);
  const latest = points.at(-1)!;
  const availableStart =
    rollingPoints.find((point) => point.activity != null)?.date ?? rollingPoints[0].date;
  const summaries = Object.fromEntries(
    METRICS.map((metric) => [metric, summarizeMetric(points, metric)]),
  ) as Record<MarketStateMetric, MarketStateMetricSummary>;
  const industries = buildIndustryHeat(industryRows, asOf, historyStart);
  const scope = context.scope ?? 'all';
  const scopeOptions = context.scopeOptions ?? [
    {
      value: scope,
      startDate: availableStart,
      endDate: asOf,
      trend: latest.trend,
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
    industries,
  };
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
  asOf: string,
  historyStart: string,
): IndustryHeatItem[] {
  const historyRows = rows.filter((row) => row.tradeDate >= historyStart && row.tradeDate <= asOf);
  const latestRows = historyRows.filter((row) => row.tradeDate === asOf);
  const latestTrendValues = latestRows.map((row) => row.excessReturn20);
  const latestBreadthValues = latestRows.map(industryBreadth);

  const items = latestRows.map((row) => {
    const trendScore = scorePercentile(latestTrendValues, row.excessReturn20);
    const breadth = industryBreadth(row);
    const breadthScore = scorePercentile(latestBreadthValues, breadth);
    const ownActivity = historyRows
      .filter((candidate) => candidate.l1Code === row.l1Code)
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
