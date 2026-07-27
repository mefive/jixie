import type { TradeDate, TsCode } from './types.js';

export type IndexValuationMetric = 'peTtm' | 'pb' | 'pe' | 'turnoverRate';

export interface IndexValuationCatalogItem {
  tsCode: TsCode;
  startDate: TradeDate;
  endDate: TradeDate;
  rows: number;
}

export interface IndexValuationCatalog {
  indices: IndexValuationCatalogItem[];
}

export interface IndexValuationPoint {
  date: TradeDate;
  close: number;
  pe: number | null;
  peTtm: number | null;
  pb: number | null;
  turnoverRate: number | null;
}

export interface IndexValuationMetricSummary {
  value: number | null;
  percentile10Year: number | null;
  percentileAll: number | null;
}

export interface IndexValuationSeries {
  tsCode: TsCode;
  asOf: TradeDate;
  tenYearStart: TradeDate;
  points: IndexValuationPoint[];
  summaries: Record<IndexValuationMetric, IndexValuationMetricSummary>;
}
