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

/**
 * 呈现市场或指数气象的指标与分类，供看板卡片。
 * Describe market or index measures and classifications for weather cards.
 */
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

/**
 * 将同类气象对象组合为展示分组。
 * Group comparable weather objects for display.
 */
export interface MarketWeatherGroup {
  key: string;
  codes: string[];
}

/**
 * 保留一个气象周期的边界与对象结果。
 * Describe weather period boundaries and object results.
 */
export interface MarketWeatherPeriod {
  key: string;
  startDate: TradeDate;
  endDate: TradeDate;
  snapshotDate: TradeDate;
  items: MarketWeatherItem[];
}

/**
 * 组合不同频率的市场气象历史。
 * Collect market weather history across frequencies.
 */
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

/**
 * 保留行业指标、表现和气象分类。
 * Describe industry measures, performance and weather classification.
 */
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

/**
 * 汇总单周期各行业气象，供行业热图。
 * Collect industry weather within one period for heatmaps.
 */
export interface IndustryWeatherPeriod {
  key: string;
  startDate: TradeDate;
  endDate: TradeDate;
  snapshotDate: TradeDate;
  industries: IndustryWeatherItem[];
}

/**
 * 返回行业气象各周期序列，供看板比较。
 * Return industry weather histories for dashboard comparison.
 */
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

/**
 * 定义描述性市场状态的公开逐日指标。
 * Describe public daily descriptive market-state measures.
 */
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
