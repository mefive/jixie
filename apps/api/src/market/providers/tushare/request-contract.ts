/**
 * 维护使用的接口参数与传输方式；字段业务语义归各领域。
 *
 * Parameters and transport modes used by maintenance; field semantics belong to domains.
 */
export const MAINTENANCE_SOURCE_REQUESTS: Readonly<
  Record<string, { parameters: readonly string[]; snapshotLimit?: number }>
> = {
  trade_cal: { parameters: ['exchange', 'start_date', 'end_date'], snapshotLimit: 6000 },
  stock_basic: { parameters: ['list_status'], snapshotLimit: 10000 },
  namechange: { parameters: ['start_date', 'end_date'] },
  daily: { parameters: ['trade_date'] },
  adj_factor: { parameters: ['trade_date'] },
  daily_basic: { parameters: ['trade_date'] },
  stk_limit: { parameters: ['trade_date'] },
  suspend_d: { parameters: ['trade_date', 'suspend_type'], snapshotLimit: 5000 },
  etf_basic: { parameters: [], snapshotLimit: 5000 },
  fund_basic: { parameters: ['market'], snapshotLimit: 20000 },
  fund_daily: { parameters: ['ts_code', 'start_date', 'end_date'] },
  fund_adj: { parameters: ['ts_code', 'start_date', 'end_date'] },
  etf_share_size: { parameters: ['trade_date'] },
  index_daily: { parameters: ['ts_code', 'start_date', 'end_date'] },
  index_dailybasic: { parameters: ['ts_code', 'start_date', 'end_date'] },
  index_weight: { parameters: ['index_code', 'start_date', 'end_date'] },
  income_vip: { parameters: ['period', 'report_type'] },
  balancesheet_vip: { parameters: ['period', 'report_type'] },
  cashflow_vip: { parameters: ['period', 'report_type'] },
  fina_indicator_vip: { parameters: ['period'] },
  dividend: { parameters: ['ts_code'], snapshotLimit: 2000 },
};
