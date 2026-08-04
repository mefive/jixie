import type { TradeDate } from './types.js';

export type MarketStateMetric = 'activity' | 'breadth' | 'trend' | 'crowding';

export type MarketWeatherFrequency = 'week' | 'month' | 'quarter' | 'year';

export type MarketWeatherDimension = 'industry' | 'scale' | 'board' | 'style';

export type MarketWeatherState =
  | 'undervalued'
  | 'warming'
  | 'expanding'
  | 'overheated'
  | 'crowded'
  | 'cooling'
  | 'balanced';

export interface MarketWeatherItem {
  code: string;
  name: string;
  periodReturn: number | null;
  benchmarkCode: string | null;
  benchmarkName: string | null;
  relativeReturn: number | null;
  heatScore: number;
  heatChange: number | null;
  activityScore: number | null;
  breadthScore: number | null;
  valuationPercentile: number | null;
  valuationSource: 'official' | 'constituents' | null;
  state: MarketWeatherState;
  coverage: 'full' | 'partial';
}

export interface MarketWeatherGroup {
  key: string;
  codes: string[];
}

export interface MarketWeatherPeriod {
  key: string;
  startDate: TradeDate;
  endDate: TradeDate;
  snapshotDate: TradeDate;
  items: MarketWeatherItem[];
}

export interface MarketWeatherSeries {
  dimension: MarketWeatherDimension;
  frequency: MarketWeatherFrequency;
  startDate: TradeDate;
  endDate: TradeDate;
  groups: MarketWeatherGroup[];
  periods: MarketWeatherPeriod[];
}

export type IndustryWeatherState =
  | 'undervalued'
  | 'warming'
  | 'expanding'
  | 'overheated'
  | 'crowded'
  | 'cooling'
  | 'balanced';

export interface IndustryWeatherItem {
  l1Code: string;
  l1Name: string;
  periodReturn: number | null;
  heatScore: number;
  heatChange: number | null;
  activityScore: number;
  breadthScore: number;
  valuationPercentile: number | null;
  state: IndustryWeatherState;
}

export interface IndustryWeatherPeriod {
  key: string;
  startDate: TradeDate;
  endDate: TradeDate;
  snapshotDate: TradeDate;
  industries: IndustryWeatherItem[];
}

export interface IndustryWeatherSeries {
  frequency: MarketWeatherFrequency;
  startDate: TradeDate;
  endDate: TradeDate;
  periods: IndustryWeatherPeriod[];
}

export type MarketStateRegime = 'hotBroad' | 'hotNarrow' | 'coldBroad' | 'coldWeak' | 'balanced';

export type MarketStateScope =
  | 'all'
  | '000016.SH'
  | '000300.SH'
  | '000905.SH'
  | '000852.SH'
  | '932000.CSI'
  | '000510.SH'
  | '399006.SZ'
  | '000688.SH'
  | '000922.CSI';

export interface MarketStateScopeOption {
  value: MarketStateScope;
  startDate: TradeDate;
  endDate: TradeDate;
  return5Day: number | null;
  return20Day: number | null;
  return60Day: number | null;
  breadth: number | null;
}

export type MarketStylePairKey = 'csi300' | 'csi500' | 'csi800';

export interface MarketStyleIndexLeg {
  tsCode: string;
  name: string;
  source: string;
  return5Day: number | null;
  return20Day: number | null;
  return60Day: number | null;
}

export interface MarketStylePair {
  key: MarketStylePairKey;
  growth: MarketStyleIndexLeg;
  value: MarketStyleIndexLeg;
  spread5Day: number | null;
  spread20Day: number | null;
  spread60Day: number | null;
}

export interface MarketStateMetricSummary {
  value: number | null;
  percentile3Year: number | null;
}

export interface MarketStatePoint {
  date: TradeDate;
  activity: number | null;
  breadth: number | null;
  trend: number | null;
  crowding: number | null;
  advanceRatio: number | null;
  aboveMa20Ratio: number | null;
  aboveMa60Ratio: number | null;
  totalAmount: number | null;
  extremeMoveRatio: number | null;
  limitUpCount: number;
  limitDownCount: number;
  tradedCount: number;
}

export interface IndustryHeatItem {
  rank: number;
  rankChange5Day: number | null;
  rankChange20Day: number | null;
  l1Code: string;
  l1Name: string;
  tradedCount: number;
  heatScore: number;
  trendScore: number;
  breadthScore: number;
  activityScore: number;
  officialReturn5Day: number | null;
  officialReturn20Day: number | null;
  officialReturn60Day: number | null;
  pe: number | null;
  pb: number | null;
  pePercentile10Year: number | null;
  pbPercentile10Year: number | null;
  return20: number | null;
  excessReturn20: number | null;
  positiveReturn20Ratio: number | null;
  aboveMa20Ratio: number | null;
  aboveMa60Ratio: number | null;
  turnoverRate: number | null;
  amountShare: number | null;
  topFiveAmountShare: number | null;
}

export interface MarketStateSnapshot {
  scope: MarketStateScope;
  scopeOptions: MarketStateScopeOption[];
  asOf: TradeDate;
  historyStart: TradeDate;
  availableStart: TradeDate;
  membershipAsOf: TradeDate | null;
  regime: MarketStateRegime;
  summaries: Record<MarketStateMetric, MarketStateMetricSummary>;
  latest: MarketStatePoint;
  points: MarketStatePoint[];
  stylePairs: MarketStylePair[];
  industries: IndustryHeatItem[];
}
