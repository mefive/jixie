import type { TradeDate, TsCode } from '@jixie/shared';
import {
  financialStatementSourceFields,
  type FinancialStatementKind,
} from '../../fundamentals/source-contract.js';
import type { TushareClient } from './tushare-client.js';

/**
 * 约束 Tushare 股票身份与上市状态原始行，供主表同步映射。
 * Describe raw Tushare stock identities and listing states for master-data mapping.
 */
export interface StockBasicRow {
  ts_code: TsCode;
  symbol: string;
  name: string;
  area: string | null;
  industry: string | null;
  market: string | null;
  list_date: TradeDate | null;
  delist_date: TradeDate | null;
  list_status: string;
}

/**
 * 读取股票清单，默认只查询已上市证券。
 * Stock list. By default only fetches instruments with list status 'L' (listed).
 */
export async function stockBasic(
  client: TushareClient,
  params: { exchange?: string; list_status?: string; market?: string } = {},
): Promise<StockBasicRow[]> {
  const rows = await client.call(
    'stock_basic',
    { list_status: 'L', ...params },
    'ts_code,symbol,name,area,industry,market,list_date,delist_date,list_status',
  );
  return rows as unknown as StockBasicRow[];
}

/**
 * 约束 Tushare 历史名称与公告日期，供有效名称区间构造。
 * Describe raw historical names and announcements for name-spell construction.
 */
export interface NameChangeRow {
  ts_code: TsCode;
  name: string;
  start_date: TradeDate;
  end_date: TradeDate | null;
  ann_date: TradeDate | null;
  change_reason: string | null;
}

/**
 * 读取历史名称区间；start_date/end_date 参数按公告日过滤。
 * Historical name spells. `start_date` / `end_date` inputs filter the announcement date.
 */
export async function nameChange(
  client: TushareClient,
  params: { ts_code?: TsCode; start_date?: TradeDate; end_date?: TradeDate } = {},
): Promise<NameChangeRow[]> {
  const rows = await client.call(
    'namechange',
    params,
    'ts_code,name,start_date,end_date,ann_date,change_reason',
  );
  return rows as unknown as NameChangeRow[];
}

/**
 * 保留来源日历的开市标记，供交易日同步。
 * Describe source calendar open flags for session synchronization.
 */
export interface TradeCalRow {
  exchange: string;
  cal_date: TradeDate;
  is_open: number;
  pretrade_date: TradeDate | null;
}

/**
 * 读取交易日历，默认使用上海证券交易所。
 * Trading calendar. Defaults to the Shanghai exchange (SSE).
 */
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

/**
 * 保留股票未复权 OHLC 和成交量额，供存储映射而非直接复权收益。
 * Supply raw stock OHLC and trading activity for storage mapping.
 */
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

/**
 * 读取未复权日线，回测调用方必须另用复权因子处理。
 * Daily quotes (**unadjusted**). Backtests must apply adjustment via adj_factor.
 */
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

/**
 * 保留按证券与日期发布的复权因子，供价格数量换算。
 * Describe dated adjustment factors for price and quantity conversion.
 */
export interface AdjFactorRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  adj_factor: number;
}

/**
 * 读取复权因子，供 close × adj_factor 后复权计算。
 * Adjustment factor. Backtests compute close × adj_factor to get the backward-adjusted (hfq)
 * price, eliminating false gaps caused by ex-rights/ex-dividend.
 */
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

/**
 * 描述来源 ETF 身份和存续信息，供 ETF 主表刷新。
 * Describe source ETF identities and listing metadata for master refresh.
 */
export interface EtfBasicRow {
  ts_code: TsCode;
  csname: string;
  extname: string;
  cname: string | null;
  index_code: string | null;
  index_name: string | null;
  setup_date: TradeDate | null;
  list_date: TradeDate | null;
  list_status: string;
  exchange: string;
  mgr_name: string | null;
  custod_name: string | null;
  mgt_fee: number | null;
  etf_type: string | null;
}

/**
 * 读取境内 ETF 元数据；不传状态时包含 QDII 和退市标的。
 * Domestic ETF metadata, including QDII ETFs and delisted instruments when no status is passed.
 */
export async function etfBasic(
  client: TushareClient,
  params: {
    ts_code?: TsCode;
    index_code?: string;
    list_date?: TradeDate;
    list_status?: string;
    exchange?: string;
    mgr?: string;
  } = {},
): Promise<EtfBasicRow[]> {
  const rows = await client.call(
    'etf_basic',
    params,
    'ts_code,csname,extname,cname,index_code,index_name,setup_date,list_date,list_status,exchange,mgr_name,custod_name,mgt_fee,etf_type',
  );
  return rows as unknown as EtfBasicRow[];
}

/**
 * 提供公募基金分类及存续字段，供 ETF 元数据补充。
 * Supply public-fund category and listing fields for ETF enrichment.
 */
export interface FundBasicRow {
  ts_code: TsCode;
  name: string;
  fund_type: string | null;
  list_date: TradeDate | null;
  delist_date: TradeDate | null;
  status: string;
}

/**
 * 读取场内公募基金元数据，补齐 ETF 类别及退市日期。
 * Exchange-traded public-fund metadata. Used to enrich ETF rows with fund category/delist date.
 */
export async function fundBasic(
  client: TushareClient,
  params: { market?: 'E' | 'O'; status?: string } = {},
): Promise<FundBasicRow[]> {
  const rows = await client.call(
    'fund_basic',
    { market: 'E', ...params },
    'ts_code,name,fund_type,list_date,delist_date,status',
  );
  return rows as unknown as FundBasicRow[];
}

/**
 * 提供 ETF 未复权价格和成交量额，供日线同步。
 * Supply raw ETF prices and trading activity for daily synchronization.
 */
export interface FundDailyRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  pre_close: number | null;
  change: number | null;
  pct_chg: number | null;
  vol: number | null;
  amount: number | null;
}

/**
 * 读取未复权 ETF 日线。
 * ETF daily quotes (unadjusted).
 */
export async function fundDaily(
  client: TushareClient,
  params: {
    ts_code?: TsCode;
    trade_date?: TradeDate;
    start_date?: TradeDate;
    end_date?: TradeDate;
  } = {},
): Promise<FundDailyRow[]> {
  const rows = await client.call(
    'fund_daily',
    params,
    'ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount',
  );
  return rows as unknown as FundDailyRow[];
}

/**
 * 提供 ETF 复权因子，供历史价格换算。
 * Supply dated ETF adjustment factors for historical price conversion.
 */
export interface FundAdjRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  adj_factor: number;
}

/**
 * 读取 ETF 复权因子。
 * ETF adjustment factors.
 */
export async function fundAdj(
  client: TushareClient,
  params: {
    ts_code?: TsCode;
    trade_date?: TradeDate;
    start_date?: TradeDate;
    end_date?: TradeDate;
    offset?: number;
    limit?: number;
  } = {},
): Promise<FundAdjRow[]> {
  const rows = await client.call('fund_adj', params, 'ts_code,trade_date,adj_factor');
  return rows as unknown as FundAdjRow[];
}

/**
 * 提供来源 ETF 份额、净值与规模，供可得日期标记后读取。
 * Supply ETF shares, NAV and size before explicit availability assignment.
 */
export interface EtfShareSizeRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  etf_name: string;
  total_share: number;
  total_size: number | null;
  nav: number | null;
  close: number | null;
  exchange: string;
}

/**
 * 读取源交易日之后发布的 ETF 份额、规模、净值与交易所收盘。
 * ETF units, fund size, NAV, and exchange close as published after the source trade date.
 */
export async function etfShareSize(
  client: TushareClient,
  params: {
    ts_code?: TsCode;
    trade_date?: TradeDate;
    start_date?: TradeDate;
    end_date?: TradeDate;
    exchange?: string;
  } = {},
): Promise<EtfShareSizeRow[]> {
  const rows = await client.call(
    'etf_share_size',
    params,
    'trade_date,ts_code,etf_name,total_share,total_size,nav,close,exchange',
  );
  return rows as unknown as EtfShareSizeRow[];
}

/**
 * 提供来源指数日线，供基准收盘同步。
 * Supply source index bars for benchmark close synchronization.
 */
export interface IndexDailyRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  close: number;
}

/**
 * 读取指数日收盘，供基准收益和状态研究；调用方负责有界请求。
 * Index daily close (e.g. 000300.SH CSI 300) — benchmark return curves + future regime filters.
 * Callers must split ranges that may exceed the upstream response limit.
 */
export async function indexDaily(
  client: TushareClient,
  params: { ts_code: TsCode; start_date?: TradeDate; end_date?: TradeDate },
): Promise<IndexDailyRow[]> {
  const rows = await client.call('index_daily', params, 'ts_code,trade_date,close');
  return rows as unknown as IndexDailyRow[];
}

/**
 * 提供官方指数估值字段，保持供应商指数级口径。
 * Supply official index valuation fields under provider methodology.
 */
export interface IndexDailyBasicRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  total_mv: number | null;
  float_mv: number | null;
  total_share: number | null;
  float_share: number | null;
  free_share: number | null;
  turnover_rate: number | null;
  turnover_rate_f: number | null;
  pe: number | null;
  pe_ttm: number | null;
  pb: number | null;
}

/**
 * 描述官方基准类型与编制来源，供指数分类审计。
 * Describe official benchmark types and provenance for index classification audits.
 */
export interface IndexBenchmarkRow {
  ts_code: TsCode;
  symbol: string;
  name: string;
  fullname: string;
  bmk_level: string;
  bmk_type: string;
  bmk_src: string;
  idx_type: string;
}

/**
 * 读取带指数分类和编制来源的官方公募基金基准目录。
 * Official public-fund benchmark catalog with index type and compiler provenance.
 */
export async function indexBenchmark(client: TushareClient): Promise<IndexBenchmarkRow[]> {
  const rows = await client.call(
    'mkt_idx_bmk',
    {},
    'ts_code,symbol,name,fullname,bmk_level,bmk_type,bmk_src,idx_type',
  );
  return rows as unknown as IndexBenchmarkRow[];
}

/**
 * 读取上游支持的主要宽基指数每日估值。
 * Broad-market index daily valuation metrics. The upstream endpoint supports a limited set of major
 * indices and returns provider-computed PE/PB values rather than constituent-level approximations.
 */
export async function indexDailyBasic(
  client: TushareClient,
  params: { ts_code: TsCode; start_date?: TradeDate; end_date?: TradeDate },
): Promise<IndexDailyBasicRow[]> {
  const rows = await client.call(
    'index_dailybasic',
    params,
    'ts_code,trade_date,total_mv,float_mv,total_share,float_share,free_share,turnover_rate,turnover_rate_f,pe,pe_ttm,pb',
  );
  return rows as unknown as IndexDailyBasicRow[];
}

/**
 * 描述来源实际交割合约规格，供按产品过滤持久化。
 * Describe actual-contract specifications before product-filtered persistence.
 */
export interface FutureContractRow {
  ts_code: TsCode;
  symbol: string;
  exchange: string;
  name: string;
  fut_code: string;
  multiplier: number | null;
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

export type FutureExchange = 'CFFEX' | 'SHFE' | 'DCE' | 'CZCE' | 'INE' | 'GFEX';

/**
 * 读取期货合约元数据，调用方必须筛选已配置的实际交割合约。
 * Futures contract metadata. Callers must filter the exchange response to explicitly configured
 * actual delivery-month products before persistence.
 */
export async function futureContracts(
  client: TushareClient,
  params: {
    exchange: FutureExchange;
    fut_type?: string;
    fut_code?: string;
    list_date?: TradeDate;
  },
): Promise<FutureContractRow[]> {
  const rows = await client.call(
    'fut_basic',
    params,
    'ts_code,symbol,exchange,name,fut_code,multiplier,trade_unit,per_unit,quote_unit,quote_unit_desc,d_mode_desc,list_date,delist_date,d_month,last_ddate,trade_time_desc',
  );
  return rows as unknown as FutureContractRow[];
}

/**
 * 提供期货实际合约原始日线与持仓量。
 * Supply actual-contract raw futures bars and open interest.
 */
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

/**
 * 读取单个实际期货合约的原始日线。
 * Raw daily bars for one actual futures contract.
 */
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

/**
 * 保留供应商逻辑符号到交割合约的日期映射。
 * Describe dated provider mappings from logical symbols to delivery contracts.
 */
export interface FutureMappingRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  mapping_ts_code: TsCode;
}

/**
 * 读取逻辑主力或连续符号与实际交割合约的每日映射。
 * Daily mapping from a logical main/continuous futures symbol to the actual delivery contract.
 */
export async function futureMapping(
  client: TushareClient,
  params: { ts_code: TsCode; start_date: TradeDate; end_date: TradeDate },
): Promise<FutureMappingRow[]> {
  const rows = await client.call('fut_mapping', params, 'ts_code,trade_date,mapping_ts_code');
  return rows as unknown as FutureMappingRow[];
}

/**
 * 提供实际合约历史费用与保证金参数。
 * Supply actual-contract historical fees and margin parameters.
 */
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

/**
 * 读取实际交割合约的历史交易所结算参数。
 * Historical exchange settlement parameters for one actual futures contract.
 */
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

/**
 * 提供交易所仓单明细，聚合前须去除小计并明确单位。
 * Supply exchange receipt details before subtotal filtering and unit-aware aggregation.
 */
export interface FutureWarehouseReceiptRow {
  trade_date: TradeDate;
  symbol: string;
  fut_name: string;
  warehouse: string | null;
  wh_id: string | null;
  pre_vol: number | null;
  vol: number | null;
  vol_chg: number | null;
  area: string | null;
  year: string | null;
  grade: string | null;
  brand: string | null;
  place: string | null;
  pd: string | null;
  is_ct: string | null;
  unit: string | null;
  exchange: string | null;
}

/**
 * 读取交易所仓单来源行，调用方须按产品隔离并清除小计行。
 * Exchange warehouse-receipt rows. Callers must isolate the configured product name, remove
 * subtotal rows, and preserve the provider's product-specific unit before aggregation.
 */
export async function futureWarehouseReceipts(
  client: TushareClient,
  params: {
    trade_date?: TradeDate;
    symbol?: string;
    start_date?: TradeDate;
    end_date?: TradeDate;
    exchange?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<FutureWarehouseReceiptRow[]> {
  const rows = await client.call(
    'fut_wsr',
    params,
    'trade_date,symbol,fut_name,warehouse,wh_id,pre_vol,vol,vol_chg,area,year,grade,brand,place,pd,is_ct,unit,exchange',
  );
  return rows as unknown as FutureWarehouseReceiptRow[];
}

/**
 * 保留交易所会员排名来源，不代表全部市场参与者。
 * Describe exchange member rankings without implying whole-market coverage.
 */
export interface FutureHoldingRow {
  trade_date: TradeDate;
  symbol: string;
  broker: string;
  vol: number | null;
  vol_chg: number | null;
  long_hld: number | null;
  long_chg: number | null;
  short_hld: number | null;
  short_chg: number | null;
  exchange: string | null;
}

/**
 * 读取交易所会员排名；各指标只是排名子集，缺失和零不能混为完整市场持仓。
 * Exchange-published daily member rankings. Each metric is a ranked subset; null (DCE) or zero
 * (SHFE) means that member was not present in that metric's ranking on the date.
 */
export async function futureHoldings(
  client: TushareClient,
  params: {
    trade_date?: TradeDate;
    symbol?: string;
    start_date?: TradeDate;
    end_date?: TradeDate;
    exchange?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<FutureHoldingRow[]> {
  const rows = await client.call(
    'fut_holding',
    params,
    'trade_date,symbol,broker,vol,vol_chg,long_hld,long_chg,short_hld,short_chg,exchange',
  );
  return rows as unknown as FutureHoldingRow[];
}

/**
 * 提供当日原始涨跌停价，供成交限制校验。
 * Supply dated raw price limits for fill validation.
 */
export interface StkLimitRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  up_limit: number; // limit-up price (unadjusted)
  down_limit: number; // limit-down price (unadjusted)
}

/**
 * 读取未复权涨跌停价，供禁止涨停买入和跌停卖出。
 * Daily up/down price limits (unadjusted). Used to block fills at the limit (no buy at limit-up,
 * no sell at limit-down). Limits are board-specific (main board ±10 / ST ±5 / STAR & ChiNext ±20 /
 * BSE ±30) — Tushare returns the actual price.
 */
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

/**
 * 保留单次上榜原因的龙虎榜行，供同证券合并净额。
 * Supply reason-specific Dragon-Tiger List rows for per-instrument aggregation.
 */
export interface TopListRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  net_amount: number | null; // Dragon-Tiger List net buy amount (CNY)
}

/**
 * 读取当日龙虎榜来源，同一证券可能因多个上榜原因出现多行。
 * Dragon-Tiger List: stocks with abnormal activity that day. A stock can appear on multiple
 * lists (reasons) → multiple rows/day; the sync sums net_amount per (code, date). An extreme
 * attention / hot-money signal.
 */
export async function topList(
  client: TushareClient,
  params: { trade_date?: TradeDate; ts_code?: TsCode } = {},
): Promise<TopListRow[]> {
  const rows = await client.call('top_list', params, 'ts_code,trade_date,net_amount');
  return rows as unknown as TopListRow[];
}

/**
 * 提供以万元计的大小单流量，供标准化资金流同步。
 * Supply order-size money flows in ten-thousand CNY for normalized synchronization.
 */
export interface MoneyflowRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  buy_lg_amount: number | null; // large-order buy amount (10k CNY)
  buy_elg_amount: number | null; // extra-large-order buy amount (10k CNY)
  sell_lg_amount: number | null;
  sell_elg_amount: number | null;
  net_mf_amount: number | null; // net inflow (10k CNY, all order sizes)
}

/**
 * 读取个股每日资金流，单位万元；主力净流入为大单与特大单买卖差。
 * Daily moneyflow (per-stock, 10k CNY). Main-force net = (large + extra-large) buys − (large +
 * extra-large) sells — the "smart-money / attention" signal; net_mf_amount = total net inflow
 * across all order sizes.
 */
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

/**
 * 提供每日估值、股本及换手字段，供时点截面存储。
 * Supply daily valuation, share-capital and turnover fields for dated cross-sections.
 */
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
 * 读取供应商按每日信息计算的估值指标，历史值不采用当前财务直接回填。
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

/**
 * 保留证券财务指标、报告期与公告日期，供版本选择。
 * Supply financial indicators, reporting periods and announcements for version selection.
 */
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
  update_flag: string | null; // 1 = revised record
}

/**
 * 按证券读取各报告期财务指标，可能含重复报告期版本。
 * Financial indicators per report period. Pulled per ts_code (one call returns its full history,
 * with possible duplicate periods from restatements). Rate-limited at 80/min on lower tiers.
 */
export async function finaIndicator(
  client: TushareClient,
  params: { ts_code: TsCode; start_date?: TradeDate; end_date?: TradeDate },
): Promise<FinaIndicatorRow[]> {
  const rows = await client.call(
    'fina_indicator',
    params,
    'ts_code,ann_date,end_date,roe,roe_waa,roa,grossprofit_margin,netprofit_margin,debt_to_assets,or_yoy,netprofit_yoy,ocf_to_profit,update_flag',
  );
  return rows as unknown as FinaIndicatorRow[];
}

/**
 * 使用 VIP 接口读取单报告期全市场财务指标，依赖供应商权限。
 * Fetch one report period for the whole A-share market. The VIP endpoint requires 5,000 points
 * and currently caps one response at 10,000 rows.
 */
export async function finaIndicatorVip(
  client: TushareClient,
  period: TradeDate,
): Promise<FinaIndicatorRow[]> {
  const pageSize = 10_000;
  const rows: FinaIndicatorRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await client.call(
      'fina_indicator_vip',
      { period, limit: pageSize, offset },
      'ts_code,ann_date,end_date,roe,roe_waa,roa,grossprofit_margin,netprofit_margin,debt_to_assets,or_yoy,netprofit_yoy,ocf_to_profit,update_flag',
    );
    rows.push(...(page as unknown as FinaIndicatorRow[]));
    if (page.length < pageSize) {
      return rows;
    }
  }
}

export type FinancialStatementReportType = '1' | '4' | '5';

/**
 * 定义三张原始报表共享的身份和版本元数据。
 * Define identity and version metadata shared by raw statements.
 */
export interface FinancialStatementBaseRow {
  ts_code: TsCode;
  ann_date: TradeDate | null;
  f_ann_date: TradeDate | null;
  end_date: TradeDate;
  report_type: string;
  comp_type: string;
  update_flag: string | null;
}

/**
 * 保留原始利润表科目，供版本化存储与流量标准化。
 * Supply raw income fields for versioned storage and flow normalization.
 */
export interface IncomeStatementRow extends FinancialStatementBaseRow {
  total_revenue: number | null;
  revenue: number | null;
  oper_cost: number | null;
  operate_profit: number | null;
  total_profit: number | null;
  income_tax: number | null;
  n_income: number | null;
  n_income_attr_p: number | null;
  ebit: number | null;
  rd_exp: number | null;
  fin_exp_int_exp: number | null;
}

/**
 * 保留原始资产负债表存量，供财务状态解析。
 * Supply raw balance-sheet stocks for financial-state resolution.
 */
export interface BalanceSheetRow extends FinancialStatementBaseRow {
  money_cap: number | null;
  trad_asset: number | null;
  notes_receiv: number | null;
  accounts_receiv: number | null;
  accounts_receiv_bill: number | null;
  oth_receiv: number | null;
  oth_rcv_total: number | null;
  inventories: number | null;
  prepayment: number | null;
  contract_assets: number | null;
  oth_cur_assets: number | null;
  total_cur_assets: number | null;
  fix_assets: number | null;
  fix_assets_total: number | null;
  cip: number | null;
  cip_total: number | null;
  intan_assets: number | null;
  goodwill: number | null;
  defer_tax_assets: number | null;
  oth_nca: number | null;
  total_nca: number | null;
  total_assets: number | null;
  notes_payable: number | null;
  acct_payable: number | null;
  accounts_pay: number | null;
  adv_receipts: number | null;
  contract_liab: number | null;
  payroll_payable: number | null;
  taxes_payable: number | null;
  oth_payable: number | null;
  oth_pay_total: number | null;
  st_borr: number | null;
  non_cur_liab_due_1y: number | null;
  lt_borr: number | null;
  bond_payable: number | null;
  oth_cur_liab: number | null;
  total_cur_liab: number | null;
  oth_ncl: number | null;
  total_ncl: number | null;
  total_liab: number | null;
  minority_int: number | null;
  total_hldr_eqy_exc_min_int: number | null;
  total_share: number | null;
}

/**
 * 保留原始现金流量表科目，供流量标准化。
 * Supply raw cash-flow fields for normalization.
 */
export interface CashFlowStatementRow extends FinancialStatementBaseRow {
  n_cashflow_act: number | null;
  c_pay_acq_const_fiolta: number | null;
  n_cashflow_inv_act: number | null;
  n_cash_flows_fnc_act: number | null;
  c_pay_dist_dpcp_int_exp: number | null;
  n_incr_cash_cash_equ: number | null;
  c_cash_equ_beg_period: number | null;
  c_cash_equ_end_period: number | null;
  net_profit: number | null;
  depr_fa_coga_dpba: number | null;
  amort_intang_assets: number | null;
  free_cashflow: number | null;
}

export function incomeStatement(
  client: TushareClient,
  params: FinancialStatementStockParams,
): Promise<IncomeStatementRow[]> {
  return financialStatementByStock(client, 'income', 'income', params);
}

export function balanceSheet(
  client: TushareClient,
  params: FinancialStatementStockParams,
): Promise<BalanceSheetRow[]> {
  return financialStatementByStock(client, 'balancesheet', 'balance_sheet', params);
}

export function cashFlowStatement(
  client: TushareClient,
  params: FinancialStatementStockParams,
): Promise<CashFlowStatementRow[]> {
  return financialStatementByStock(client, 'cashflow', 'cash_flow', params);
}

export function incomeStatementVip(
  client: TushareClient,
  period: TradeDate,
  reportType: FinancialStatementReportType,
): Promise<IncomeStatementRow[]> {
  return financialStatementVip(client, 'income_vip', 'income', period, reportType);
}

export function balanceSheetVip(
  client: TushareClient,
  period: TradeDate,
  reportType: FinancialStatementReportType,
): Promise<BalanceSheetRow[]> {
  return financialStatementVip(client, 'balancesheet_vip', 'balance_sheet', period, reportType);
}

export function cashFlowStatementVip(
  client: TushareClient,
  period: TradeDate,
  reportType: FinancialStatementReportType,
): Promise<CashFlowStatementRow[]> {
  return financialStatementVip(client, 'cashflow_vip', 'cash_flow', period, reportType);
}

/**
 * 限定单证券财报来源查询的类型与公告窗口。
 * Configure per-stock statement type and announcement bounds.
 */
interface FinancialStatementStockParams {
  ts_code: TsCode;
  start_date: TradeDate;
  end_date: TradeDate;
  report_type: FinancialStatementReportType;
}

async function financialStatementByStock<Row extends FinancialStatementBaseRow>(
  client: TushareClient,
  apiName: 'income' | 'balancesheet' | 'cashflow',
  statementKind: FinancialStatementKind,
  params: FinancialStatementStockParams,
): Promise<Row[]> {
  const rows = await client.call(
    apiName,
    { ...params },
    financialStatementSourceFields(statementKind).join(','),
  );
  return rows as unknown as Row[];
}

/**
 * 构造并执行显式类型的 VIP 财报请求，供按期同步。
 * Build and execute an explicitly typed VIP statement request.
 */
async function financialStatementVip<Row extends FinancialStatementBaseRow>(
  client: TushareClient,
  apiName: 'income_vip' | 'balancesheet_vip' | 'cashflow_vip',
  statementKind: FinancialStatementKind,
  period: TradeDate,
  reportType: FinancialStatementReportType,
): Promise<Row[]> {
  const pageSize = 5_000;
  const rows: Row[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await client.call(
      apiName,
      { period, report_type: reportType, limit: pageSize, offset },
      financialStatementSourceFields(statementKind).join(','),
    );
    rows.push(...(page as unknown as Row[]));
    if (page.length < pageSize) {
      return rows;
    }
  }
}

/**
 * 保留分红方案、实施阶段和日期，供历史可见性读取。
 * Describe dividend proposals, implementation stages and dates for historical visibility.
 */
export interface DividendRow {
  ts_code: TsCode;
  end_date: TradeDate; // distribution's report period
  ann_date: TradeDate | null;
  ex_date: TradeDate | null; // ex-dividend date (PIT gate)
  div_proc: string | null; // distribution stage ('实施' = actually paid)
  cash_div: number | null; // pre-tax cash dividend per share
  cash_div_tax: number | null;
}

/**
 * 按证券读取分红各阶段原始行，同报告期可有多个阶段记录。
 * Dividend distributions. Pulled per ts_code; a period yields several rows across stages.
 */
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

/**
 * 提供月度指数成员及权重，供时点证券池。
 * Supply dated index members and weights for historical universes.
 */
export interface IndexWeightRow {
  index_code: string;
  con_code: TsCode;
  trade_date: TradeDate; // monthly snapshot date
  weight: number | null;
}

/**
 * 读取月度指数成分权重；调用方须按区间拆分避免行数上限。
 * Index constituents + weights (monthly snapshots). A wide date range can exceed the per-call row
 * cap, so callers should fetch in chunks (e.g. by quarter).
 */
export async function indexWeight(
  client: TushareClient,
  params: { index_code: string; start_date: TradeDate; end_date: TradeDate },
): Promise<IndexWeightRow[]> {
  const rows = await client.call('index_weight', params, 'index_code,con_code,trade_date,weight');
  return rows as unknown as IndexWeightRow[];
}

/**
 * 提供申万版本与行业层级，供行业代码白名单。
 * Describe Shenwan versions and levels for an industry-code allowlist.
 */
export interface IndexClassifyRow {
  index_code: string; // SW industry index code, e.g. 801120.SI
  industry_name: string;
  level: string; // L1 / L2 / L3
}

/**
 * 提供申万行业指数日线，供行业状态聚合。
 * Supply Shenwan index bars for industry-state aggregation.
 */
export interface SwDailyRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  name: string;
  open: number | null;
  low: number | null;
  high: number | null;
  close: number | null;
  change: number | null;
  pct_change: number | null;
  vol: number | null;
  amount: number | null;
  pe: number | null;
  pb: number | null;
  float_mv: number | null;
  total_mv: number | null;
}

/**
 * 读取申万指数日线，调用方须先通过分类清单限定 SW2021 一级代码。
 * Shenwan index daily bars. Callers must whitelist SW2021 level-1 codes via index_classify.
 */
export async function swDaily(
  client: TushareClient,
  params: {
    ts_code?: TsCode;
    trade_date?: TradeDate;
    start_date?: TradeDate;
    end_date?: TradeDate;
  },
): Promise<SwDailyRow[]> {
  const rows = await client.call(
    'sw_daily',
    params,
    'ts_code,trade_date,name,open,low,high,close,change,pct_change,vol,amount,pe,pb,float_mv,total_mv',
  );
  return rows as unknown as SwDailyRow[];
}

/**
 * 读取申万行业分类清单，默认 SW2021 一级行业。
 * Shenwan industry classification list. Defaults to SW2021 level-1 (the 31 top-level industries).
 */
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

/**
 * 保留证券行业生效区间，供历史成员映射。
 * Describe industry membership intervals for historical lookup.
 */
export interface IndexMemberRow {
  l1_code: string;
  l1_name: string;
  ts_code: TsCode;
  in_date: TradeDate; // date the stock entered this industry
  out_date: TradeDate | null; // date it left; null = current member
  is_new: string; // Y = current membership, N = historical
}

/**
 * 读取申万行业成员，is_new 区分当前和历史归属。
 * Shenwan industry members (by level-1 code). `is_new` selects current ('Y') vs historical ('N')
 * membership — to build the full point-in-time history, callers fetch both and union.
 */
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
