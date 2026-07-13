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

export interface IndexDailyRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  close: number;
}

/** Index daily close (e.g. 000300.SH CSI 300) — benchmark return curves + future regime filters.
 * One call returns the whole range (a few thousand rows). */
export async function indexDaily(
  client: TushareClient,
  params: { ts_code: TsCode; start_date?: TradeDate; end_date?: TradeDate },
): Promise<IndexDailyRow[]> {
  const rows = await client.call('index_daily', params, 'ts_code,trade_date,close');
  return rows as unknown as IndexDailyRow[];
}

export interface FutureContractRow {
  ts_code: TsCode;
  symbol: string;
  exchange: string;
  name: string;
  fut_code: string;
  multiplier: number;
  trade_unit: string | null;
  per_unit: number | null;
  quote_unit: string | null;
  quote_unit_desc: string | null;
  d_mode_desc: string | null;
  list_date: TradeDate;
  delist_date: TradeDate;
  d_month: string | null;
  last_ddate: TradeDate | null;
  trade_time_desc: string | null;
}

/** CFFEX futures contract metadata. Callers filter the response to actual IF/IH/IC/IM contracts. */
export async function futureContracts(
  client: TushareClient,
  params: { exchange: 'CFFEX'; fut_type?: string; fut_code?: string; list_date?: TradeDate },
): Promise<FutureContractRow[]> {
  const rows = await client.call(
    'fut_basic',
    params,
    'ts_code,symbol,exchange,name,fut_code,multiplier,trade_unit,per_unit,quote_unit,quote_unit_desc,d_mode_desc,list_date,delist_date,d_month,last_ddate,trade_time_desc',
  );
  return rows as unknown as FutureContractRow[];
}

export interface FutureDailyRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  pre_close: number | null;
  pre_settle: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  settle: number | null;
  change1: number | null;
  change2: number | null;
  vol: number | null;
  amount: number | null;
  oi: number | null;
  oi_chg: number | null;
  delv_settle: number | null;
}

/** Raw daily bars for one actual futures contract. */
export async function futureDaily(
  client: TushareClient,
  params: { ts_code: TsCode; start_date: TradeDate; end_date: TradeDate },
): Promise<FutureDailyRow[]> {
  const rows = await client.call(
    'fut_daily',
    params,
    'ts_code,trade_date,pre_close,pre_settle,open,high,low,close,settle,change1,change2,vol,amount,oi,oi_chg,delv_settle',
  );
  return rows as unknown as FutureDailyRow[];
}

export interface FutureMappingRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  mapping_ts_code: TsCode;
}

/** Daily mapping from a logical main/continuous futures symbol to the actual delivery contract. */
export async function futureMapping(
  client: TushareClient,
  params: { ts_code: TsCode; start_date: TradeDate; end_date: TradeDate },
): Promise<FutureMappingRow[]> {
  const rows = await client.call('fut_mapping', params, 'ts_code,trade_date,mapping_ts_code');
  return rows as unknown as FutureMappingRow[];
}

export interface FutureSettlementRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  settle: number | null;
  trading_fee_rate: number | null;
  trading_fee: number | null;
  delivery_fee: number | null;
  b_hedging_margin_rate: number | null;
  s_hedging_margin_rate: number | null;
  long_margin_rate: number | null;
  short_margin_rate: number | null;
  offset_today_fee: number | null;
  exchange: string | null;
}

/** Historical exchange settlement parameters for one actual futures contract. */
export async function futureSettlement(
  client: TushareClient,
  params: { ts_code: TsCode; start_date: TradeDate; end_date: TradeDate },
): Promise<FutureSettlementRow[]> {
  const rows = await client.call(
    'fut_settle',
    params,
    'ts_code,trade_date,settle,trading_fee_rate,trading_fee,delivery_fee,b_hedging_margin_rate,s_hedging_margin_rate,long_margin_rate,short_margin_rate,offset_today_fee,exchange',
  );
  return rows as unknown as FutureSettlementRow[];
}

export interface StkLimitRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  up_limit: number; // limit-up price (unadjusted)
  down_limit: number; // limit-down price (unadjusted)
}

/** Daily up/down price limits (unadjusted). Used to block fills at the limit (no buy at limit-up,
 * no sell at limit-down). Limits are board-specific (main board ±10 / ST ±5 / STAR & ChiNext ±20 /
 * BSE ±30) — Tushare returns the actual price. */
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
  net_amount: number | null; // Dragon-Tiger List net buy amount (CNY)
}

/** Dragon-Tiger List: stocks with abnormal activity that day. A stock can appear on multiple
 * lists (reasons) → multiple rows/day; the sync sums net_amount per (code, date). An extreme
 * attention / hot-money signal. */
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
  buy_lg_amount: number | null; // large-order buy amount (10k CNY)
  buy_elg_amount: number | null; // extra-large-order buy amount (10k CNY)
  sell_lg_amount: number | null;
  sell_elg_amount: number | null;
  net_mf_amount: number | null; // net inflow (10k CNY, all order sizes)
}

/** Daily moneyflow (per-stock, 10k CNY). Main-force net = (large + extra-large) buys − (large +
 * extra-large) sells — the "smart-money / attention" signal; net_mf_amount = total net inflow
 * across all order sizes. */
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
  turnover_rate_f: number | null; // turnover based on free-float shares %
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
    'ts_code,trade_date,pe,pe_ttm,pb,ps,ps_ttm,dv_ratio,dv_ttm,total_mv,circ_mv,turnover_rate,turnover_rate_f',
  );
  return rows as unknown as DailyBasicRow[];
}

export interface FinaIndicatorRow {
  ts_code: TsCode;
  ann_date: TradeDate | null; // announcement date (PIT gate)
  end_date: TradeDate; // report period end
  roe: number | null; // return on equity, %
  roe_waa: number | null; // weighted-average return on equity, %
  roa: number | null; // return on assets, %
  grossprofit_margin: number | null; // gross profit margin, %
  netprofit_margin: number | null; // net profit margin, %
  debt_to_assets: number | null; // debt-to-assets ratio, %
  or_yoy: number | null; // revenue YoY growth, %
  netprofit_yoy: number | null; // net profit attributable to parent, YoY growth, %
  ocf_to_profit: number | null; // operating cash flow / operating profit
}

/** Financial indicators per report period. Pulled per ts_code (one call returns its full history,
 * with possible duplicate periods from restatements). Rate-limited at 80/min on lower tiers. */
export async function finaIndicator(
  client: TushareClient,
  params: { ts_code: TsCode; start_date?: TradeDate; end_date?: TradeDate },
): Promise<FinaIndicatorRow[]> {
  const rows = await client.call(
    'fina_indicator',
    params,
    'ts_code,ann_date,end_date,roe,roe_waa,roa,grossprofit_margin,netprofit_margin,debt_to_assets,or_yoy,netprofit_yoy,ocf_to_profit',
  );
  return rows as unknown as FinaIndicatorRow[];
}

export interface DividendRow {
  ts_code: TsCode;
  end_date: TradeDate; // distribution's report period
  ann_date: TradeDate | null;
  ex_date: TradeDate | null; // ex-dividend date (PIT gate)
  div_proc: string | null; // distribution stage ('实施' = actually paid)
  cash_div: number | null; // pre-tax cash dividend per share
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

export interface IndexClassifyRow {
  index_code: string; // SW industry index code, e.g. 801120.SI
  industry_name: string;
  level: string; // L1 / L2 / L3
}

/** Shenwan industry classification list. Defaults to SW2021 level-1 (the 31 top-level industries). */
export async function indexClassify(
  client: TushareClient,
  params: { level?: string; src?: string } = {},
): Promise<IndexClassifyRow[]> {
  const rows = await client.call(
    'index_classify',
    { level: 'L1', src: 'SW2021', ...params },
    'index_code,industry_name,level',
  );
  return rows as unknown as IndexClassifyRow[];
}

export interface IndexMemberRow {
  l1_code: string;
  l1_name: string;
  ts_code: TsCode;
  in_date: TradeDate; // date the stock entered this industry
  out_date: TradeDate | null; // date it left; null = current member
  is_new: string; // Y = current membership, N = historical
}

/** Shenwan industry members (by level-1 code). `is_new` selects current ('Y') vs historical ('N')
 * membership — to build the full point-in-time history, callers fetch both and union. */
export async function indexMemberAll(
  client: TushareClient,
  params: { l1_code: string; is_new?: string },
): Promise<IndexMemberRow[]> {
  const rows = await client.call(
    'index_member_all',
    params,
    'l1_code,l1_name,ts_code,in_date,out_date,is_new',
  );
  return rows as unknown as IndexMemberRow[];
}
