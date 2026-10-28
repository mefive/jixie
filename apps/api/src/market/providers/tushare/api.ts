import type { TradeDate, TsCode } from '@jixie/shared';
import {
  financialStatementSourceFields,
  type FinancialStatementKind,
} from '../../fundamentals/source-contract.js';
import type { TushareClient } from './tushare-client.js';

/**
 * 约束 Tushare 股票身份与上市状态原始行，供主表同步映射。
 *
 * Describe raw Tushare stock identities and listing states for master-data mapping.
 */
export interface StockBasicRow {
  ts_code: TsCode;
  symbol: string;
  name: string;
  area: string | null;
  market: string | null;
  list_date: TradeDate | null;
  delist_date: TradeDate | null;
  list_status: string;
}

/**
 * 读取股票清单，默认只查询已上市证券。
 *
 * Stock list. By default only fetches instruments with list status 'L' (listed).
 */
export async function stockBasic(
  client: Pick<TushareClient, 'call'>,
  params: { exchange?: string; list_status?: string; market?: string } = {},
): Promise<StockBasicRow[]> {
  const rows = await client.call(
    'stock_basic',
    { list_status: 'L', ...params },
    'ts_code,symbol,name,area,market,list_date,delist_date,list_status',
  );
  return rows as unknown as StockBasicRow[];
}

/**
 * 约束 Tushare 历史名称与公告日期，供有效名称区间构造。
 *
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
 *
 * Historical name spells. `start_date` / `end_date` inputs filter the announcement date.
 */
export async function nameChange(
  client: Pick<TushareClient, 'call'>,
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
 *
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
 *
 * Trading calendar. Defaults to the Shanghai exchange (SSE).
 */
export async function tradeCal(
  client: Pick<TushareClient, 'call'>,
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
 *
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
 *
 * Daily quotes (**unadjusted**). Backtests must apply adjustment via adj_factor.
 */
export async function daily(
  client: Pick<TushareClient, 'call'>,
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
 *
 * Describe dated adjustment factors for price and quantity conversion.
 */
export interface AdjFactorRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  adj_factor: number;
}

/**
 * 读取复权因子，供 close × adj_factor 后复权计算。
 *
 * Adjustment factor. Backtests compute close × adj_factor to get the backward-adjusted (hfq)
 * price, eliminating false gaps caused by ex-rights/ex-dividend.
 */
export async function adjFactor(
  client: Pick<TushareClient, 'call'>,
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
 *
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
 *
 * Domestic ETF metadata, including QDII ETFs and delisted instruments when no status is passed.
 */
export async function etfBasic(
  client: Pick<TushareClient, 'call'>,
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
 *
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
 *
 * Exchange-traded public-fund metadata. Used to enrich ETF rows with fund category/delist date.
 */
export async function fundBasic(
  client: Pick<TushareClient, 'call'>,
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
 *
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
 *
 * ETF daily quotes (unadjusted).
 */
export async function fundDaily(
  client: Pick<TushareClient, 'call'>,
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
 *
 * Supply dated ETF adjustment factors for historical price conversion.
 */
export interface FundAdjRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  adj_factor: number;
}

/**
 * 读取 ETF 复权因子。
 *
 * ETF adjustment factors.
 */
export async function fundAdj(
  client: Pick<TushareClient, 'call'>,
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
 * 提供来源指数日线，供基准收盘同步。
 *
 * Supply source index bars for benchmark close synchronization.
 */
export interface IndexDailyRow {
  ts_code: TsCode;
  trade_date: TradeDate;
  close: number;
}

/**
 * 读取指数日收盘，供基准收益和状态研究；调用方负责有界请求。
 *
 * Index daily close (e.g. 000300.SH CSI 300) — benchmark return curves + future regime filters.
 * Callers must split ranges that may exceed the upstream response limit.
 */
export async function indexDaily(
  client: Pick<TushareClient, 'call'>,
  params: { ts_code: TsCode; start_date?: TradeDate; end_date?: TradeDate },
): Promise<IndexDailyRow[]> {
  const rows = await client.call('index_daily', params, 'ts_code,trade_date,close');
  return rows as unknown as IndexDailyRow[];
}

/**
 * 提供官方指数估值字段，保持供应商指数级口径。
 *
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
 * 读取上游支持的主要宽基指数每日估值。
 *
 * Broad-market index daily valuation metrics. The upstream endpoint supports a limited set of major
 * indices and returns provider-computed PE/PB values rather than constituent-level approximations.
 */
export async function indexDailyBasic(
  client: Pick<TushareClient, 'call'>,
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
 * 提供当日原始涨跌停价，供成交限制校验。
 *
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
 *
 * Daily up/down price limits (unadjusted). Used to block fills at the limit (no buy at limit-up,
 * no sell at limit-down). Limits are board-specific (main board ±10 / ST ±5 / STAR & ChiNext ±20 /
 * BSE ±30) — Tushare returns the actual price.
 */
export async function stkLimit(
  client: Pick<TushareClient, 'call'>,
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
 * 提供每日估值、股本及换手字段，供时点截面存储。
 *
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
 *
 * Daily valuation metrics. These are point-in-time by construction (Tushare computes each day's
 * pe_ttm etc. from financials known as of that day), so they're safe to use directly per trade date.
 */
export async function dailyBasic(
  client: Pick<TushareClient, 'call'>,
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
 *
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
 *
 * Financial indicators per report period. Pulled per ts_code (one call returns its full history,
 * with possible duplicate periods from restatements). Rate-limited at 80/min on lower tiers.
 */
export async function finaIndicator(
  client: Pick<TushareClient, 'call'>,
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
 *
 * Fetch one report period for the whole A-share market. The VIP endpoint requires 5,000 points
 * and currently caps one response at 10,000 rows.
 */
export async function finaIndicatorVip(
  client: Pick<TushareClient, 'call'>,
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
 *
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
 *
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
 *
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
 *
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
  client: Pick<TushareClient, 'call'>,
  params: FinancialStatementStockParams,
): Promise<IncomeStatementRow[]> {
  return financialStatementByStock(client, 'income', 'income', params);
}

export function balanceSheet(
  client: Pick<TushareClient, 'call'>,
  params: FinancialStatementStockParams,
): Promise<BalanceSheetRow[]> {
  return financialStatementByStock(client, 'balancesheet', 'balance_sheet', params);
}

export function cashFlowStatement(
  client: Pick<TushareClient, 'call'>,
  params: FinancialStatementStockParams,
): Promise<CashFlowStatementRow[]> {
  return financialStatementByStock(client, 'cashflow', 'cash_flow', params);
}

export function incomeStatementVip(
  client: Pick<TushareClient, 'call'>,
  period: TradeDate,
  reportType: FinancialStatementReportType,
): Promise<IncomeStatementRow[]> {
  return financialStatementVip(client, 'income_vip', 'income', period, reportType);
}

export function balanceSheetVip(
  client: Pick<TushareClient, 'call'>,
  period: TradeDate,
  reportType: FinancialStatementReportType,
): Promise<BalanceSheetRow[]> {
  return financialStatementVip(client, 'balancesheet_vip', 'balance_sheet', period, reportType);
}

export function cashFlowStatementVip(
  client: Pick<TushareClient, 'call'>,
  period: TradeDate,
  reportType: FinancialStatementReportType,
): Promise<CashFlowStatementRow[]> {
  return financialStatementVip(client, 'cashflow_vip', 'cash_flow', period, reportType);
}

/**
 * 限定单证券财报来源查询的类型与公告窗口。
 *
 * Configure per-stock statement type and announcement bounds.
 */
interface FinancialStatementStockParams {
  ts_code: TsCode;
  start_date: TradeDate;
  end_date: TradeDate;
  report_type: FinancialStatementReportType;
}

async function financialStatementByStock<Row extends FinancialStatementBaseRow>(
  client: Pick<TushareClient, 'call'>,
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
 *
 * Build and execute an explicitly typed VIP statement request.
 */
async function financialStatementVip<Row extends FinancialStatementBaseRow>(
  client: Pick<TushareClient, 'call'>,
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
 *
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
 *
 * Dividend distributions. Pulled per ts_code; a period yields several rows across stages.
 */
export async function dividend(
  client: Pick<TushareClient, 'call'>,
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
 *
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
 *
 * Index constituents + weights (monthly snapshots). A wide date range can exceed the per-call row
 * cap, so callers should fetch in chunks (e.g. by quarter).
 */
export async function indexWeight(
  client: Pick<TushareClient, 'call'>,
  params: { index_code: string; start_date: TradeDate; end_date: TradeDate },
): Promise<IndexWeightRow[]> {
  const rows = await client.call('index_weight', params, 'index_code,con_code,trade_date,weight');
  return rows as unknown as IndexWeightRow[];
}
