/**
 * 维护使用的接口参数与传输方式；字段业务语义归各领域。
 *
 * Parameters and transport modes used by maintenance; field semantics belong to domains.
 */
export const INGESTION_SOURCE_REQUESTS: Readonly<
  Record<
    string,
    {
      parameters: readonly string[];
      pageSize?: number;
    }
  >
> = {
  trade_cal: { parameters: ['exchange', 'start_date', 'end_date'] },
  stock_basic: { parameters: ['list_status'] },
  namechange: { parameters: ['start_date', 'end_date'] },
  daily: { parameters: ['trade_date'] },
  adj_factor: { parameters: ['trade_date'] },
  daily_basic: { parameters: ['trade_date'] },
  stk_limit: { parameters: ['trade_date'] },
  suspend_d: { parameters: ['trade_date', 'suspend_type'] },
  etf_basic: { parameters: [] },
  fund_basic: { parameters: ['market'] },
  fund_daily: { parameters: ['trade_date', 'ts_code', 'start_date', 'end_date'] },
  fund_adj: { parameters: ['trade_date', 'ts_code', 'start_date', 'end_date'], pageSize: 2000 },
  etf_share_size: { parameters: ['trade_date'] },
  index_daily: { parameters: ['ts_code', 'start_date', 'end_date'] },
  index_dailybasic: { parameters: ['ts_code', 'start_date', 'end_date'], pageSize: 3000 },
  index_weight: { parameters: ['index_code', 'trade_date'] },
  income_vip: {
    parameters: [
      'period',
      'report_type',
      'ts_code',
      'ann_date',
      'f_ann_date',
      'start_date',
      'end_date',
    ],
  },
  balancesheet_vip: {
    parameters: [
      'period',
      'report_type',
      'ts_code',
      'ann_date',
      'f_ann_date',
      'start_date',
      'end_date',
    ],
  },
  cashflow_vip: {
    parameters: [
      'period',
      'report_type',
      'ts_code',
      'ann_date',
      'f_ann_date',
      'start_date',
      'end_date',
    ],
  },
  fina_indicator_vip: { parameters: ['period', 'ts_code'] },
  dividend: {
    parameters: ['ts_code', 'ann_date', 'imp_ann_date'],
    pageSize: 2000,
  },
};
