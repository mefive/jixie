import type { TradeDate, TsCode } from './types.js';

/**
 * Stock screener (产品线 2: 选股看图). A natural-language query → a structured ScreenSpec → filter the
 * latest whole-market snapshot → a table of matching stocks → click one to see its K线/PE/量 charts.
 * This is exploration, not backtesting: filters apply to each stock's most recent metrics.
 */

export type ScreenOp = '>' | '>=' | '<' | '<=';

/** Numeric fields a screen filter / sort may reference (latest snapshot). */
export type ScreenField =
  | 'close'
  | 'pctChg'
  | 'pe'
  | 'peTtm'
  | 'pb'
  | 'ps'
  | 'dvRatio'
  | 'totalMv'
  | 'circMv'
  | 'turnoverRate';

export interface ScreenFilter {
  field: ScreenField;
  op: ScreenOp;
  value: number;
}

export interface ScreenSpec {
  filters: ScreenFilter[];
  sort?: { field: ScreenField; dir: 'asc' | 'desc' };
  limit?: number; // default 50, capped server-side
}

/** One row of screen results (a stock's latest snapshot). */
export interface ScreenRow {
  tsCode: TsCode;
  name: string;
  industry: string | null;
  tradeDate: TradeDate; // the snapshot date these values are from
  close: number | null;
  pctChg: number | null;
  pe: number | null;
  peTtm: number | null;
  pb: number | null;
  ps: number | null;
  dvRatio: number | null;
  totalMv: number | null; // 万元
  circMv: number | null; // 万元
  turnoverRate: number | null;
}

export interface ScreenResult {
  tradeDate: TradeDate; // snapshot date the screen ran on
  total: number; // number of matches (before limit)
  rows: ScreenRow[];
}

/** One day of a stock's chart series (raw/unadjusted, as a broker displays). */
export interface StockSeriesPoint {
  date: TradeDate;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  vol: number | null; // 手
  pe: number | null; // from daily_basic
}

export interface StockSeries {
  tsCode: TsCode;
  name: string;
  points: StockSeriesPoint[];
}
