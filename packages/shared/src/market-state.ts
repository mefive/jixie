import type { TradeDate } from './types.js';

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

/** Point-in-time constituent universes maintained for market indicators. */
export const MARKET_STATE_INDEX_CODES = [
  '000016.SH', // SSE 50
  '000300.SH', // CSI 300
  '000905.SH', // CSI 500
  '000852.SH', // CSI 1000
  '932000.CSI', // CSI 2000
  '000510.SH', // CSI A500
  '399006.SZ', // ChiNext
  '000688.SH', // STAR 50
  '000922.CSI', // CSI Dividend
] as const;

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
