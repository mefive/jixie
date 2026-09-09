export const CNY_BASE_CURRENCY = 'CNY';
export const HKD_CNH_DERIVED_CODE = 'HKDCNH.DERIVED';

export type CrossMarketBenchmarkMarket = 'CN' | 'HK' | 'US';

export interface CrossMarketBenchmarkDefinition {
  id: string;
  provider: 'Tushare Pro';
  providerCode: string;
  sourceApi: 'index_daily' | 'index_global';
  nameZh: string;
  nameEn: string;
  market: CrossMarketBenchmarkMarket;
  currency: 'CNY' | 'HKD' | 'USD';
  timeZone: string;
  calendarId: string;
  observesDaylightSavingTime: boolean;
  returnType: 'price_return';
  dataContractId: string;
  tradableProxyTsCode: string;
  tradableProxyKind: 'domestic_etf' | 'qdii_etf';
}

export const CROSS_MARKET_BENCHMARKS = [
  {
    id: 'equity.cn.csi300.price',
    provider: 'Tushare Pro',
    providerCode: '000300.SH',
    sourceApi: 'index_daily',
    nameZh: '沪深 300 价格指数',
    nameEn: 'CSI 300 Price Index',
    market: 'CN',
    currency: 'CNY',
    timeZone: 'Asia/Shanghai',
    calendarId: 'SSE_SZSE',
    observesDaylightSavingTime: false,
    returnType: 'price_return',
    dataContractId: 'cn.equity_benchmark.price.daily',
    tradableProxyTsCode: '510300.SH',
    tradableProxyKind: 'domestic_etf',
  },
  {
    id: 'equity.hk.hsi.price',
    provider: 'Tushare Pro',
    providerCode: 'HSI',
    sourceApi: 'index_global',
    nameZh: '恒生价格指数',
    nameEn: 'Hang Seng Price Index',
    market: 'HK',
    currency: 'HKD',
    timeZone: 'Asia/Hong_Kong',
    calendarId: 'HKEX',
    observesDaylightSavingTime: false,
    returnType: 'price_return',
    dataContractId: 'hk.equity_benchmark.price.daily',
    tradableProxyTsCode: '159920.SZ',
    tradableProxyKind: 'qdii_etf',
  },
  {
    id: 'equity.us.spx.price',
    provider: 'Tushare Pro',
    providerCode: 'SPX',
    sourceApi: 'index_global',
    nameZh: '标普 500 价格指数',
    nameEn: 'S&P 500 Price Index',
    market: 'US',
    currency: 'USD',
    timeZone: 'America/New_York',
    calendarId: 'NYSE_NASDAQ',
    observesDaylightSavingTime: true,
    returnType: 'price_return',
    dataContractId: 'us.equity_benchmark.price.daily',
    tradableProxyTsCode: '513500.SH',
    tradableProxyKind: 'qdii_etf',
  },
] as const satisfies readonly CrossMarketBenchmarkDefinition[];

export const CROSS_MARKET_BENCHMARK_BY_ID: ReadonlyMap<string, CrossMarketBenchmarkDefinition> =
  new Map(CROSS_MARKET_BENCHMARKS.map((benchmark) => [benchmark.id, benchmark]));
