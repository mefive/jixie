import type { TradeDate, TsCode } from './types.js';

export type IndexValuationMetric = 'peTtm' | 'pb' | 'pe' | 'turnoverRate';

/**
 * 描述可查询指数估值身份及指标覆盖。
 * Describe index valuation identity and available measures.
 */
export interface IndexValuationCatalogItem {
  tsCode: TsCode;
  startDate: TradeDate;
  endDate: TradeDate;
  rows: number;
}

/**
 * 组合指数估值目录和默认查询信息。
 * Collect valuation catalog entries and query defaults.
 */
export interface IndexValuationCatalog {
  indices: IndexValuationCatalogItem[];
}

/**
 * 记录估值数值与历史分位，供逐日图表。
 * Describe dated valuation levels and historical percentiles.
 */
export interface IndexValuationPoint {
  date: TradeDate;
  close: number;
  pe: number | null;
  peTtm: number | null;
  pb: number | null;
  turnoverRate: number | null;
}

/**
 * 汇总单估值指标当前值、分位与覆盖。
 * Summarize a valuation measure's current value, percentile and coverage.
 */
export interface IndexValuationMetricSummary {
  value: number | null;
  percentile10Year: number | null;
  percentileAll: number | null;
}

/**
 * 返回指数估值历史、单位和当前摘要。
 * Return valuation history, units and current summaries.
 */
export interface IndexValuationSeries {
  tsCode: TsCode;
  asOf: TradeDate;
  tenYearStart: TradeDate;
  points: IndexValuationPoint[];
  summaries: Record<IndexValuationMetric, IndexValuationMetricSummary>;
}
