import type { TradeDate, TsCode } from './types.js';

/** One daily point for an instrument detail chart. Fields that do not apply to an asset are null. */
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

/** Price-series payload retained for chart compatibility; identity is carried by the object route. */
export interface StockSeries {
  tsCode: TsCode;
  name: string;
  points: StockSeriesPoint[];
}
