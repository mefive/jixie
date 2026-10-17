/**
 * 表示含交易所后缀的 Tushare 证券代码，不单凭裸数字标识证券。
 * Tushare-style stock code, e.g. '000001.SZ' (Shenzhen) / '600000.SH' (Shanghai) / '430047.BJ' (Beijing)
 */
export type TsCode = string;

/**
 * 表示 YYYYMMDD 格式交易日期，供跨模块统一日期传输。
 * Trade date, format YYYYMMDD, e.g. '20240131'
 */
export type TradeDate = string;
