import type { TradeDate } from './types.js';

export type MarketStateMetric = 'activity' | 'breadth' | 'trend' | 'crowding';

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
  trend: number | null;
  breadth: number | null;
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
  l1Code: string;
  l1Name: string;
  tradedCount: number;
  heatScore: number;
  trendScore: number;
  breadthScore: number;
  activityScore: number;
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
  industries: IndustryHeatItem[];
}
