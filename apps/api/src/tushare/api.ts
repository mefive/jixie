import type { TsCode, TradeDate } from '@jixie/shared';
import type { TushareClient } from './client.js';

export interface StockBasicRow {
  ts_code: TsCode;
  symbol: string;
  name: string;
  area: string | null;
  industry: string | null;
  market: string;
  list_date: TradeDate;
  list_status: string;
}

/** Stock list. By default only fetches instruments with list status 'L' (listed). */
export async function stockBasic(
  client: TushareClient,
  params: { exchange?: string; list_status?: string; market?: string } = {},
): Promise<StockBasicRow[]> {
  const rows = await client.call(
    'stock_basic',
    { list_status: 'L', ...params },
    'ts_code,symbol,name,area,industry,market,list_date,list_status',
  );
  return rows as unknown as StockBasicRow[];
}

export interface TradeCalRow {
  exchange: string;
  cal_date: TradeDate;
  is_open: number;
  pretrade_date: TradeDate | null;
}

/** Trading calendar. Defaults to the Shanghai exchange (SSE). */
export async function tradeCal(
  client: TushareClient,
  params: {
    exchange?: string;
    start_date?: TradeDate;
    end_date?: TradeDate;
    is_open?: string;
  } = {},
): Promise<TradeCalRow[]> {
  const rows = await client.call(
    'trade_cal',
    { exchange: 'SSE', ...params },
    'exchange,cal_date,is_open,pretrade_date',
  );
  return rows as unknown as TradeCalRow[];
}

export interface DailyRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  open: number;
  high: number;
  low: number;
  close: number;
  pre_close: number;
  change: number;
  pct_chg: number;
  vol: number;
  amount: number;
}

/** Daily quotes (**unadjusted**). Backtests must apply adjustment via adj_factor. */
export async function daily(
  client: TushareClient,
  params: {
    ts_code?: TsCode;
    trade_date?: TradeDate;
    start_date?: TradeDate;
    end_date?: TradeDate;
  } = {},
): Promise<DailyRow[]> {
  const rows = await client.call('daily', params);
  return rows as unknown as DailyRow[];
}

export interface AdjFactorRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  adj_factor: number;
}

/** Adjustment factor. Backtests compute close × adj_factor to get the backward-adjusted (hfq)
 * price, eliminating false gaps caused by ex-rights/ex-dividend. */
export async function adjFactor(
  client: TushareClient,
  params: {
    ts_code?: TsCode;
    trade_date?: TradeDate;
    start_date?: TradeDate;
    end_date?: TradeDate;
  } = {},
): Promise<AdjFactorRow[]> {
  const rows = await client.call('adj_factor', params);
  return rows as unknown as AdjFactorRow[];
}

export interface StkLimitRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  up_limit: number; // 涨停价 (unadjusted)
  down_limit: number; // 跌停价 (unadjusted)
}

/** Daily up/down price limits (unadjusted). Used to block fills at the limit (涨停不可买、跌停不可卖).
 * Limits are board-specific (主板±10/ST±5/双创±20/北交所±30) — Tushare returns the actual price. */
export async function stkLimit(
  client: TushareClient,
  params: {
    ts_code?: TsCode;
    trade_date?: TradeDate;
    start_date?: TradeDate;
    end_date?: TradeDate;
  } = {},
): Promise<StkLimitRow[]> {
  const rows = await client.call('stk_limit', params, 'ts_code,trade_date,up_limit,down_limit');
  return rows as unknown as StkLimitRow[];
}

export interface TopListRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  net_amount: number | null; // 龙虎榜净买入额 (元)
}

/** 龙虎榜 (Dragon-Tiger List): stocks with abnormal activity that day. A stock can appear on multiple
 * 榜单 (reasons) → multiple rows/day; the sync sums net_amount per (code, date). 关注度/游资 极端信号。 */
export async function topList(
  client: TushareClient,
  params: { trade_date?: TradeDate; ts_code?: TsCode } = {},
): Promise<TopListRow[]> {
  const rows = await client.call('top_list', params, 'ts_code,trade_date,net_amount');
  return rows as unknown as TopListRow[];
}

export interface MoneyflowRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  buy_lg_amount: number | null; // 大单买入额 (万元)
  buy_elg_amount: number | null; // 特大单买入额 (万元)
  sell_lg_amount: number | null;
  sell_elg_amount: number | null;
  net_mf_amount: number | null; // 净流入额 (万元, all order sizes)
}

/** Daily moneyflow (per-stock 资金流, 万元). 主力净额 = (大单+特大单)买 − (大单+特大单)卖 — the
 * "smart-money / 关注度" signal; net_mf_amount = total net inflow across all order sizes. */
export async function moneyflow(
  client: TushareClient,
  params: {
    ts_code?: TsCode;
    trade_date?: TradeDate;
    start_date?: TradeDate;
    end_date?: TradeDate;
  } = {},
): Promise<MoneyflowRow[]> {
  const rows = await client.call(
    'moneyflow',
    params,
    'ts_code,trade_date,buy_lg_amount,buy_elg_amount,sell_lg_amount,sell_elg_amount,net_mf_amount',
  );
  return rows as unknown as MoneyflowRow[];
}

export interface DailyBasicRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  pe: number | null; // P/E (current)
  pe_ttm: number | null; // P/E (trailing twelve months)
  pb: number | null; // P/B
  ps: number | null; // P/S
  ps_ttm: number | null; // P/S (TTM)
  dv_ratio: number | null; // dividend yield %
  dv_ttm: number | null; // dividend yield % (TTM)
  total_mv: number | null; // total market cap (10k yuan)
  circ_mv: number | null; // circulating market cap (10k yuan)
  turnover_rate: number | null; // turnover %
}

/**
 * Daily valuation metrics. These are point-in-time by construction (Tushare computes each day's
 * pe_ttm etc. from financials known as of that day), so they're safe to use directly per trade date.
 */
export async function dailyBasic(
  client: TushareClient,
  params: {
    ts_code?: TsCode;
    trade_date?: TradeDate;
    start_date?: TradeDate;
    end_date?: TradeDate;
  } = {},
): Promise<DailyBasicRow[]> {
  const rows = await client.call(
    'daily_basic',
    params,
    'ts_code,trade_date,pe,pe_ttm,pb,ps,ps_ttm,dv_ratio,dv_ttm,total_mv,circ_mv,turnover_rate',
  );
  return rows as unknown as DailyBasicRow[];
}

export interface FinaIndicatorRow {
  ts_code: TsCode;
  ann_date: TradeDate | null; // announcement date (PIT gate)
  end_date: TradeDate; // report period end
  roe: number | null; // 净资产收益率 %
  roe_waa: number | null; // 加权平均净资产收益率 %
}

/** Financial indicators per report period. Pulled per ts_code (one call returns its full history,
 * with possible duplicate periods from restatements). Rate-limited at 80/min on lower tiers. */
export async function finaIndicator(
  client: TushareClient,
  params: { ts_code: TsCode; start_date?: TradeDate; end_date?: TradeDate },
): Promise<FinaIndicatorRow[]> {
  const rows = await client.call('fina_indicator', params, 'ts_code,ann_date,end_date,roe,roe_waa');
  return rows as unknown as FinaIndicatorRow[];
}

export interface DividendRow {
  ts_code: TsCode;
  end_date: TradeDate; // distribution's report period
  ann_date: TradeDate | null;
  ex_date: TradeDate | null; // ex-dividend date (PIT gate)
  div_proc: string | null; // 实施进度 ('实施' = actually paid)
  cash_div: number | null; // 税前每股现金分红
  cash_div_tax: number | null;
}

/** Dividend distributions. Pulled per ts_code; a period yields several rows across stages. */
export async function dividend(
  client: TushareClient,
  params: { ts_code: TsCode },
): Promise<DividendRow[]> {
  const rows = await client.call(
    'dividend',
    params,
    'ts_code,end_date,ann_date,ex_date,div_proc,cash_div,cash_div_tax',
  );
  return rows as unknown as DividendRow[];
}

export interface IndexWeightRow {
  index_code: string;
  con_code: TsCode;
  trade_date: TradeDate; // monthly snapshot date
  weight: number | null;
}

/** Index constituents + weights (monthly snapshots). A wide date range can exceed the per-call row
 * cap, so callers should fetch in chunks (e.g. by quarter). */
export async function indexWeight(
  client: TushareClient,
  params: { index_code: string; start_date: TradeDate; end_date: TradeDate },
): Promise<IndexWeightRow[]> {
  const rows = await client.call('index_weight', params, 'index_code,con_code,trade_date,weight');
  return rows as unknown as IndexWeightRow[];
}
