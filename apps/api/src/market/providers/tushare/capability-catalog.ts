import { addDays } from '#date';

export type TushareCapabilityDomain = 'equity' | 'etf' | 'rates' | 'macro';
export type TushareCapabilityFrequency = 'reference' | 'event' | 'daily' | 'monthly' | 'quarterly';
export type TushareCapabilityProbeCoverage =
  | 'single_date'
  | 'bounded_window'
  | 'full_response'
  | 'reference_snapshot';

/**
 * 定义来源能力的域、频率、权限与探测覆盖。
 *
 * Describe provider capability domain, frequency, permissions and probe coverage.
 */
export interface TushareCapabilityDefinitionV1 {
  version: 1;
  domain: TushareCapabilityDomain;
  apiName: string;
  nameZh: string;
  nameEn: string;
  keywords: string[];
  requiredFields: string[];
  permission:
    | { kind: 'points'; minimumPoints: number; documentedAsOf: string }
    | { kind: 'separate_permission'; documentedAsOf: string }
    | { kind: 'token_dependent' };
  history: {
    frequency: TushareCapabilityFrequency;
    field?: string;
    probeCoverage: TushareCapabilityProbeCoverage;
  };
  params: (probeDate: string) => Record<string, unknown>;
}

export const TUSHARE_CAPABILITY_CATALOG_VERSION = 1;

export const TUSHARE_CAPABILITIES: readonly TushareCapabilityDefinitionV1[] = [
  capability({
    domain: 'equity',
    apiName: 'index_global',
    nameZh: '国际主要股票价格指数',
    nameEn: 'Major international equity price indices',
    keywords: ['恒生指数', '标普500', 'HSI', 'SPX', 'global index'],
    requiredFields: [
      'ts_code',
      'trade_date',
      'open',
      'high',
      'low',
      'close',
      'pre_close',
      'change',
      'pct_chg',
    ],
    permission: { kind: 'points', minimumPoints: 6000, documentedAsOf: '2026-08-16' },
    history: { frequency: 'daily', field: 'trade_date', probeCoverage: 'bounded_window' },
    params: (date) => ({ ts_code: 'HSI', start_date: addDays(date, -10), end_date: date }),
  }),
  capability({
    domain: 'etf',
    apiName: 'etf_share_size',
    nameZh: 'ETF 份额与规模',
    nameEn: 'ETF shares and size',
    keywords: ['ETF 规模', 'ETF 份额', 'fund size', 'fund shares'],
    requiredFields: ['trade_date', 'ts_code', 'etf_name', 'total_share', 'total_size', 'exchange'],
    permission: { kind: 'points', minimumPoints: 8000, documentedAsOf: '2026-08-04' },
    history: { frequency: 'daily', field: 'trade_date', probeCoverage: 'single_date' },
    params: (date) => ({ trade_date: date }),
  }),
  capability({
    domain: 'rates',
    apiName: 'yc_cb',
    nameZh: '中债收益率曲线',
    nameEn: 'ChinaBond yield curve',
    keywords: ['中债曲线', '中债国债收益率', 'ChinaBond yield'],
    requiredFields: [],
    permission: { kind: 'separate_permission', documentedAsOf: '2026-08-04' },
    history: { frequency: 'daily', field: 'trade_date', probeCoverage: 'single_date' },
    params: (date) => ({ trade_date: date }),
  }),
  capability({
    domain: 'rates',
    apiName: 'shibor',
    nameZh: '上海银行间同业拆放利率',
    nameEn: 'Shanghai Interbank Offered Rate',
    keywords: ['Shibor', '银行间利率', 'money market rate'],
    requiredFields: ['date', 'on', '1w', '2w', '1m', '3m', '6m', '9m', '1y'],
    history: { frequency: 'daily', field: 'date', probeCoverage: 'single_date' },
    params: (date) => ({ date }),
  }),
  capability({
    domain: 'rates',
    apiName: 'repo_daily',
    nameZh: '交易所回购日行情',
    nameEn: 'Exchange repo daily quote',
    keywords: ['交易所回购', 'repo rate', 'GC001', 'R007'],
    requiredFields: ['ts_code', 'trade_date', 'repo_maturity', 'close', 'weight', 'amount'],
    history: { frequency: 'daily', field: 'trade_date', probeCoverage: 'single_date' },
    params: (date) => ({ trade_date: date }),
  }),
  capability({
    domain: 'rates',
    apiName: 'shibor_lpr',
    nameZh: '贷款市场报价利率',
    nameEn: 'Loan prime rate',
    keywords: ['LPR', '贷款市场报价利率', 'loan prime rate'],
    requiredFields: ['date', '1y', '5y'],
    history: { frequency: 'monthly', field: 'date', probeCoverage: 'bounded_window' },
    params: (date) => ({ start_date: addDays(date, -45), end_date: date }),
  }),
  capability({
    domain: 'macro',
    apiName: 'cn_pmi',
    nameZh: '中国采购经理指数',
    nameEn: 'China purchasing managers index',
    keywords: ['PMI', '采购经理指数', 'manufacturing PMI'],
    requiredFields: ['MONTH', 'PMI010000'],
    history: { frequency: 'monthly', field: 'MONTH', probeCoverage: 'full_response' },
    params: () => ({}),
  }),
  capability({
    domain: 'macro',
    apiName: 'cn_gdp',
    nameZh: '中国国内生产总值',
    nameEn: 'China gross domestic product',
    keywords: ['GDP', '国内生产总值', 'China GDP'],
    requiredFields: ['quarter', 'gdp', 'gdp_yoy', 'pi', 'si', 'ti'],
    history: { frequency: 'quarterly', field: 'quarter', probeCoverage: 'full_response' },
    params: () => ({}),
  }),
  capability({
    domain: 'macro',
    apiName: 'cn_cpi',
    nameZh: '中国居民消费价格指数',
    nameEn: 'China consumer price index',
    keywords: ['CPI', '居民消费价格', 'China inflation'],
    requiredFields: ['month', 'nt_val', 'nt_yoy', 'nt_mom'],
    history: { frequency: 'monthly', field: 'month', probeCoverage: 'full_response' },
    params: () => ({}),
  }),
  capability({
    domain: 'macro',
    apiName: 'cn_ppi',
    nameZh: '中国工业生产者价格指数',
    nameEn: 'China producer price index',
    keywords: ['PPI', '工业生产者价格', 'producer prices'],
    requiredFields: ['month', 'ppi_yoy', 'ppi_mom', 'ppi_accu'],
    history: { frequency: 'monthly', field: 'month', probeCoverage: 'full_response' },
    params: () => ({}),
  }),
  capability({
    domain: 'macro',
    apiName: 'sf_month',
    nameZh: '社会融资规模',
    nameEn: 'Aggregate financing to the real economy',
    keywords: ['社融', '社会融资', 'aggregate financing'],
    requiredFields: ['month', 'inc_month', 'inc_cumval', 'stk_endval'],
    history: { frequency: 'monthly', field: 'month', probeCoverage: 'full_response' },
    params: () => ({}),
  }),
  capability({
    domain: 'macro',
    apiName: 'cn_m',
    nameZh: '中国货币供应量',
    nameEn: 'China money supply',
    keywords: ['M1', 'M2', '货币供应量', 'money supply'],
    requiredFields: ['month', 'm0', 'm0_yoy', 'm1', 'm1_yoy', 'm2', 'm2_yoy'],
    history: { frequency: 'monthly', field: 'month', probeCoverage: 'full_response' },
    params: () => ({}),
  }),
  capability({
    domain: 'macro',
    apiName: 'us_tycr',
    nameZh: '美国国债名义收益率曲线',
    nameEn: 'US nominal Treasury yield curve',
    keywords: ['美国国债收益率', '美债名义利率', 'US Treasury yield'],
    requiredFields: ['date', 'm1', 'm2', 'm3', 'm6', 'y1', 'y2', 'y5', 'y10', 'y30'],
    history: { frequency: 'daily', field: 'date', probeCoverage: 'single_date' },
    params: (date) => ({ date }),
  }),
  capability({
    domain: 'macro',
    apiName: 'us_trycr',
    nameZh: '美国国债实际收益率曲线',
    nameEn: 'US real Treasury yield curve',
    keywords: ['美国实际利率', '美债实际收益率', 'US real yield'],
    requiredFields: ['date', 'y5', 'y7', 'y10', 'y20', 'y30'],
    history: { frequency: 'daily', field: 'date', probeCoverage: 'single_date' },
    params: (date) => ({ date }),
  }),
  capability({
    domain: 'macro',
    apiName: 'fx_daily',
    nameZh: '外汇日行情',
    nameEn: 'Foreign-exchange daily quote',
    keywords: ['美元人民币', '美元港币', 'USD/CNH', 'USD/HKD', '汇率', 'foreign exchange'],
    requiredFields: [
      'ts_code',
      'trade_date',
      'bid_open',
      'bid_close',
      'bid_high',
      'bid_low',
      'ask_open',
      'ask_close',
      'ask_high',
      'ask_low',
    ],
    history: { frequency: 'daily', field: 'trade_date', probeCoverage: 'bounded_window' },
    params: (date) => ({
      ts_code: 'USDCNH.FXCM',
      start_date: addDays(date, -10),
      end_date: date,
    }),
  }),
  capability({
    domain: 'macro',
    apiName: 'cn_schedule',
    nameZh: '中国宏观数据发布日历',
    nameEn: 'China macroeconomic release calendar',
    keywords: ['数据发布日期', '宏观日历', 'release calendar'],
    requiredFields: ['month', 'publish_date', 'title', 'issuing_org', 'data_api'],
    history: { frequency: 'event', field: 'publish_date', probeCoverage: 'full_response' },
    params: (date) => ({ date }),
  }),
];

function capability(
  definition: Omit<TushareCapabilityDefinitionV1, 'version' | 'permission'> & {
    permission?: TushareCapabilityDefinitionV1['permission'];
  },
): TushareCapabilityDefinitionV1 {
  return {
    version: 1,
    permission: { kind: 'token_dependent' },
    ...definition,
  };
}
