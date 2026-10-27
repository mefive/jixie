/**
 * 约束宿主存储返回的股票基础数据；时点选择和派生序列由 EngineData 管理，沙盒不直接访问此端口。
 *
 * Storage contract for host-side simulation. Adapters return market rows; EngineData owns
 * point-in-time selection, caches and derived series. No user-code sandbox receives this port.
 */

export interface StockBasicRow {
  tsCode: string;
  listDate: string | null;
  delistDate: string | null;
  listStatus: string;
}

/**
 * 承载模拟存储端口读取的行业成员区间，供 EngineData 按决策日选择归属。
 *
 * Carry industry membership intervals for decision-date selection by EngineData.
 */
export interface IndustryMembershipRow {
  tsCode: string;
  l1Name: string;
  inDate: string;
  outDate: string | null;
}

/**
 * 承载历史证券名称区间，供模拟恢复当时风险标记。
 *
 * Supply historical name spells for dated investability checks.
 */
export interface StockNameHistoryRow {
  tsCode: string;
  name: string;
  startDate: string;
  endDate: string | null;
}

/**
 * 提供 ETF 身份及上市元数据，供模拟按资产规则处理。
 *
 * Supply ETF identity and listing metadata for simulation rules.
 */
export interface EtfBasicDataRow {
  tsCode: string;
  listDate: string | null;
  delistDate: string | null;
  listStatus: string;
  sameDayTurnover: boolean;
}

/**
 * 提供指数原始收盘历史，供基准与指数能力读取。
 *
 * Supply raw index closes for benchmark and index capabilities.
 */
export interface IndexDailyRow {
  tsCode: string;
  tradeDate: string;
  close: number;
}

/**
 * 提供指数官方每日估值，供时点估值与分位查询。
 *
 * Supply official daily index valuations for dated values and percentiles.
 */
export interface IndexDailyBasicDataRow {
  tsCode: string;
  tradeDate: string;
  pe: number | null;
  peTtm: number | null;
  pb: number | null;
}

/**
 * 提供曲线期限、收益率及可得日期，供模拟利率读取。
 *
 * Supply curve terms, yields and availability dates for simulation reads.
 */
export interface YieldCurvePointDataRow {
  availableDate: string;
  termYears: number;
  yieldPct: number;
}

/**
 * 提供财务指标与公告身份，供 EngineData 按公开日期筛选。
 *
 * Supply financial indicators and announcement metadata for dated selection.
 */
export interface FinaIndicatorRow {
  tsCode: string;
  annDate: string;
  roe: number | null;
  roeWaa: number | null;
  roa: number | null;
  grossprofitMargin: number | null;
  debtToAssets: number | null;
}

/**
 * 提供指数成分权重快照，供时点证券池构建。
 *
 * Supply index weight snapshots for point-in-time universe construction.
 */
export interface IndexWeightRow {
  conCode: string;
  tradeDate: string;
}

/**
 * 提供实际交割合约规格与交易日期，供期货模拟。
 *
 * Supply delivery-contract specifications and dates for futures simulation.
 */
export interface FutureContractRow {
  tsCode: string;
  productCode: string;
  multiplier: number;
  listDate: string;
  delistDate: string;
}

/**
 * 提供实际期货合约日线，供撮合与历史查询。
 *
 * Supply actual-contract futures bars for execution and history reads.
 */
export interface FutureDailyDataRow {
  tsCode: string;
  tradeDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  settle: number | null;
  volume: number | null;
  amount: number | null;
  openInterest: number | null;
}

/**
 * 提供日期化主力映射，供引擎解析可执行交割合约。
 *
 * Supply dated main mappings for executable delivery-contract selection.
 */
export interface FutureMappingDataRow {
  continuousCode: string;
  tradeDate: string;
  mappedTsCode: string;
}

/**
 * 提供合约历史费用及保证金参数，供结算和执行。
 *
 * Supply historical contract fees and margin parameters for execution and settlement.
 */
export interface FutureSettlementDataRow {
  tsCode: string;
  tradeDate: string;
  longMarginRate: number | null;
  shortMarginRate: number | null;
}

/**
 * 组合期货合约、行情、映射及结算输入，供一次模拟加载。
 *
 * Collect futures metadata, bars, mappings and settlements for simulation loading.
 */
export interface FutureMarketRows {
  contracts: FutureContractRow[];
  daily: FutureDailyDataRow[];
  mappings: FutureMappingDataRow[];
  settlements: FutureSettlementDataRow[];
}

/**
 * 承载单个交易日的原始价格、复权及估值截面，可限定证券代码范围。
 *
 * One trading day's raw panel rows (price + adjustment + valuation), optionally code-restricted.
 */
export interface CrossSectionRows {
  price: {
    tsCode: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    vol: number | null;
    amount: number | null;
  }[];
  adj: { tsCode: string; adjFactor: number }[];
  basic: {
    tsCode: string;
    pe: number | null;
    peTtm: number | null;
    pb: number | null;
    ps: number | null;
    psTtm: number | null;
    dvRatio: number | null;
    dvTtm: number | null;
    totalMv: number | null;
    circMv: number | null;
    turnoverRate: number | null;
  }[];
}

/**
 * 承载回测区间内按证券读取的原始行情与按需辅助历史。
 *
 * Raw per-stock series rows over the run range, including requested auxiliary histories.
 */
export interface BarsRows {
  px: {
    tsCode: string;
    tradeDate: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    vol: number | null;
    amount: number | null;
  }[];
  adj: { tsCode: string; tradeDate: string; adjFactor: number }[];
  limits: { tsCode: string; tradeDate: string; upLimit: number; downLimit: number }[];
  turnoverRatesF: { tsCode: string; tradeDate: string; turnoverRateF: number | null }[];
}

/**
 * 声明批量行情读取所需的辅助历史，避免加载未使用的数据。
 *
 * Select auxiliary histories needed alongside raw bars for batch loading.
 */
export interface BarsRowsOptions {
  /** Load daily_basic free-float turnover only for factors that explicitly require it. */
  includeTurnoverRateF?: boolean;
}

/**
 * 隔离引擎与宿主存储的行情读取契约，由适配器提供原始数据而由引擎控制时点可见性。
 *
 * Separate simulation market reads from host storage; adapters supply raw rows and the engine
 * controls point-in-time visibility.
 */
export interface EngineDataPort {
  /** Open trading days (SSE) within [start, end], ascending. */
  openDates(start: string, end: string): Promise<string[]>;
  /** The full stock list, including historical delisting boundaries. */
  stockBasics(): Promise<StockBasicRow[]>;
  /** Point-in-time SW level-1 industry membership spells. */
  industryMemberships(): Promise<IndustryMembershipRow[]>;
  /** Point-in-time stock-name spells used to derive historical risk-warning states. */
  stockNameHistory(): Promise<StockNameHistoryRow[]>;
  /** ETF metadata needed by the daily execution lane. */
  etfBasics(): Promise<EtfBasicDataRow[]>;
  /** All synced index daily closes (tiny), ascending by (code, date). */
  indexDailyAll(): Promise<IndexDailyRow[]>;
  /** All synced broad-index valuation rows (tiny), ascending by (code, date). */
  indexDailyBasicAll(): Promise<IndexDailyBasicDataRow[]>;
  /** Official government yield-curve points available on or before `end`. */
  yieldCurvePoints(end: string): Promise<YieldCurvePointDataRow[]>;
  /** One day's cross-section panel rows; `codes` restricts the read (universe gate pushdown). */
  crossSectionRows(date: string, codes?: string[]): Promise<CrossSectionRows>;
  /** All financial-indicator reports that have a public annDate, ascending by (code, annDate). */
  finaIndicators(): Promise<FinaIndicatorRow[]>;
  /** All constituent snapshots of one index, ascending by date. */
  indexWeights(indexCode: string): Promise<IndexWeightRow[]>;
  /** Per-stock series rows for `codes` within [start, end] (implementation may chunk internally). */
  barsRows(
    codes: string[],
    start: string,
    end: string,
    options?: BarsRowsOptions,
  ): Promise<BarsRows>;
  /** Stock-index futures metadata, actual-contract bars, main mappings, and margin params. */
  futuresRange(start: string, end: string): Promise<FutureMarketRows>;
}
