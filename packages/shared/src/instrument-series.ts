import type { TradeDate, TsCode } from './types.js';

/**
 * 定义证券详情图的逐日观测，不适用字段保留空值。
 *
 * One daily point for an instrument detail chart. Fields that do not apply to an asset are null.
 */
export interface StockSeriesPoint {
  date: TradeDate;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  vol: number | null;
  pe: number | null;
  adjFactor: number | null;
}

/**
 * 保持价格图表响应兼容，稳定证券身份由对象承载。
 *
 * Price-series payload retained for chart compatibility; identity is carried by the object route.
 */
export interface StockSeries {
  tsCode: TsCode;
  name: string;
  points: StockSeriesPoint[];
}
