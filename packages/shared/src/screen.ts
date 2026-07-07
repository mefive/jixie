import type { TradeDate, TsCode } from './types.js';

/**
 * Stock screener (product line 2: screening & charting). A natural-language query → a structured ScreenSpec → filter the
 * latest whole-market snapshot → a table of matching stocks → click one to see its candlestick / PE / volume charts.
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
  value: number; // stored in the field's native unit (e.g. totalMv in 10k yuan)
}

/** Field metadata for the UI (condition chips, sort picker). `scale` converts stored↔display:
 * displayValue = stored / scale (market cap stored in 10k yuan, shown in 100M yuan → scale 1e4). */
export interface ScreenFieldDef {
  key: ScreenField;
  label: string;
  unit?: string;
  scale?: number;
}

export const SCREEN_FIELDS: ScreenFieldDef[] = [
  { key: 'close', label: '现价', unit: '元' },
  { key: 'pctChg', label: '涨跌幅', unit: '%' },
  { key: 'pe', label: '市盈率' },
  { key: 'peTtm', label: '市盈率TTM' },
  { key: 'pb', label: '市净率' },
  { key: 'ps', label: '市销率' },
  { key: 'dvRatio', label: '股息率', unit: '%' },
  { key: 'totalMv', label: '总市值', unit: '亿', scale: 1e4 },
  { key: 'circMv', label: '流通市值', unit: '亿', scale: 1e4 },
  { key: 'turnoverRate', label: '换手率', unit: '%' },
];

export const SCREEN_FIELD_BY_KEY: Record<string, ScreenFieldDef> = Object.fromEntries(
  SCREEN_FIELDS.map((f) => [f.key, f]),
);

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
  totalMv: number | null; // 10k yuan
  circMv: number | null; // 10k yuan
  turnoverRate: number | null;
}

export interface ScreenResult {
  tradeDate: TradeDate; // snapshot date the screen ran on
  total: number; // number of matches (before limit)
  rows: ScreenRow[];
}

/** One day of a stock's chart series. OHLC are raw/unadjusted; the cumulative adjFactor lets the
 * client render unadjusted (raw) / backward-adjusted (× factor) / forward-adjusted (× factor / latest factor). */
export interface StockSeriesPoint {
  date: TradeDate;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  vol: number | null; // lots (100 shares)
  pe: number | null; // from daily_basic
  adjFactor: number | null; // cumulative adjustment factor
}

export interface StockSeries {
  tsCode: TsCode;
  name: string;
  points: StockSeriesPoint[];
}
