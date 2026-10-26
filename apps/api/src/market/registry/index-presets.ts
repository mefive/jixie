/** Major broad-market indices whose close series are useful as research benchmarks.
 * This preset is intentionally broader than index_dailybasic, which supports fewer indices. */
export const CSI_300_TOTAL_RETURN_INDEX_CODE = 'H00300.CSI';

export const MAJOR_INDEX_DAILY_CODES = [
  '000001.SH', // SSE Composite
  '000016.SH', // SSE 50
  '000300.SH', // CSI 300
  CSI_300_TOTAL_RETURN_INDEX_CODE, // CSI 300 total return — backtest performance benchmark
  '000905.SH', // CSI 500
  '000852.SH', // CSI 1000
  '000985.CSI', // CSI All Share — market-residual-volatility benchmark
  '932000.CSI', // CSI 2000
  '000510.SH', // CSI A500
  '000688.SH', // STAR 50
  '000922.CSI', // CSI Dividend
  '399001.SZ', // Shenzhen Component
  '399005.SZ', // SME Board
  '399006.SZ', // ChiNext
] as const;

/**
 * 当前 Research 与 Factor 股票池使用的历史指数成分。
 *
 * Historical index constituents used by the current Research and Factor universes.
 */
export const INDEX_MEMBERSHIP_CODES = ['000300.SH', '000905.SH', '000852.SH'];

/**
 * 原始申万一级行业数据范围，后续行业数据裁剪时移除。
 *
 * Raw Shenwan level-one data scopes, retained until industry-data retirement.
 */
export const SHENWAN_LEVEL_ONE_INDUSTRY_CODES = [
  '801780.SI',
  '801790.SI',
  '801180.SI',
  '801080.SI',
  '801750.SI',
  '801770.SI',
  '801760.SI',
  '801740.SI',
  '801030.SI',
  '801040.SI',
  '801050.SI',
  '801710.SI',
  '801720.SI',
  '801950.SI',
  '801960.SI',
  '801730.SI',
  '801880.SI',
  '801890.SI',
  '801140.SI',
  '801970.SI',
  '801010.SI',
  '801110.SI',
  '801120.SI',
  '801130.SI',
  '801200.SI',
  '801210.SI',
  '801980.SI',
  '801150.SI',
  '801160.SI',
  '801170.SI',
  '801230.SI',
];

/**
 * 日常维护的原始指数行情。
 *
 * Raw index close series maintained daily.
 */
export const DAILY_MAINTAINED_INDEX_CODES = [...MAJOR_INDEX_DAILY_CODES];

/** Broad-market indices supported by Tushare index_dailybasic.
 * This is a data-coverage preset, not an investment recommendation. */
export const MAJOR_INDEX_DAILY_BASIC_CODES = [
  '000001.SH', // SSE Composite
  '000016.SH', // SSE 50
  '000300.SH', // CSI 300
  '000905.SH', // CSI 500
  '399001.SZ', // Shenzhen Component
  '399005.SZ', // SME Board
  '399006.SZ', // ChiNext
] as const;
