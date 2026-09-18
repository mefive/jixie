export type SyncArgumentKind =
  | 'dates'
  | 'months'
  | 'indices'
  | 'index'
  | 'etf'
  | 'none'
  | 'financial';

export interface SyncCommand {
  name: string;
  entry: string;
  kind: SyncArgumentKind;
  usage: string;
  description: string;
}

// Entries are relative to the API source/output root; tsx resolves .js to .ts in development.
export const syncCommands: SyncCommand[] = [
  {
    name: 'stock-prices',
    entry: 'src/market/cli/sync-stock-prices.js',
    kind: 'dates',
    usage: '[start] [end]',
    description: 'Stock metadata, calendar, daily bars and adjustment factors',
  },
  {
    name: 'stock-history',
    entry: 'src/market/cli/sync-stock-history.js',
    kind: 'dates',
    usage: '[start] [end]',
    description: 'Stock listings, historical names and code changes',
  },
  {
    name: 'basic',
    entry: 'src/market/cli/sync-basic.js',
    kind: 'dates',
    usage: '[start] [end]',
    description: 'Daily stock valuation indicators',
  },
  {
    name: 'fina',
    entry: 'src/maintenance/cli/sync-fina.js',
    kind: 'financial',
    usage: '[--repair-code CODE --start YYYYMMDD [--end YYYYMMDD]]',
    description:
      'Raw statements, indicators and dividends; full history unless repairing one stock',
  },
  {
    name: 'futures',
    entry: 'src/market/cli/sync-futures.js',
    kind: 'dates',
    usage: '[start] [end]',
    description: 'Equity index futures contracts, prices and settlements',
  },
  {
    name: 'commodity-futures',
    entry: 'src/market/cli/sync-commodity-futures.js',
    kind: 'dates',
    usage: '[start] [end]',
    description: 'Commodity futures contracts and prices',
  },
  {
    name: 'commodity-continuous',
    entry: 'src/market/cli/sync-commodity-continuous-returns.js',
    kind: 'dates',
    usage: '[start] [end]',
    description: 'Audited continuous commodity returns and main-contract mapping',
  },
  {
    name: 'commodity-holdings',
    entry: 'src/market/cli/sync-commodity-holdings.js',
    kind: 'dates',
    usage: '[start] [end]',
    description: 'Commodity futures member positions',
  },
  {
    name: 'commodity-warehouse-receipts',
    entry: 'src/market/cli/sync-commodity-warehouse-receipts.js',
    kind: 'dates',
    usage: '[start] [end]',
    description: 'Commodity warehouse receipts',
  },
  {
    name: 'etf',
    entry: 'src/market/cli/sync-etf.js',
    kind: 'etf',
    usage: '[start] [end] [registry|major|CODE,CODE] [refresh]',
    description: 'ETF metadata, prices, adjustments and share sizes',
  },
  {
    name: 'index',
    entry: 'src/market/cli/sync-index.js',
    kind: 'index',
    usage: '[market-state|CODE,CODE] [start] [end]',
    description: 'Index weights and prices',
  },
  {
    name: 'index-daily',
    entry: 'src/market/cli/sync-index-daily.js',
    kind: 'indices',
    usage: '[start] [end] [major|CODE,CODE]',
    description: 'Index daily prices only',
  },
  {
    name: 'cross-market-benchmarks',
    entry: 'src/market/cli/sync-cross-market-benchmarks.js',
    kind: 'dates',
    usage: '[start] [end]',
    description: 'Cross-market benchmark series',
  },
  {
    name: 'index-basic',
    entry: 'src/market/cli/sync-index-basic.js',
    kind: 'indices',
    usage: '[start] [end] [major|CODE,CODE]',
    description: 'Daily index valuation indicators',
  },
  {
    name: 'market-state',
    entry: 'src/market/cli/sync-market-state.js',
    kind: 'dates',
    usage: '[start] [end]',
    description: 'Precompute market, index and industry state using local data',
  },
  {
    name: 'market-reference',
    entry: 'src/market/cli/sync-market-reference.js',
    kind: 'dates',
    usage: '[start] [end]',
    description: 'Index catalog, dashboard benchmarks and industry prices',
  },
  {
    name: 'rates',
    entry: 'src/market/cli/sync-rates.js',
    kind: 'dates',
    usage: '[start] [end]',
    description: 'China government yield curves',
  },
  {
    name: 'credit-curves',
    entry: 'src/market/cli/sync-credit-curves.js',
    kind: 'dates',
    usage: '[start] [end]',
    description: 'Credit yield curves',
  },
  {
    name: 'external-market',
    entry: 'src/market/cli/sync-external-market.js',
    kind: 'dates',
    usage: '[start] [end]',
    description: 'US rates, FX and external market series',
  },
  {
    name: 'macro',
    entry: 'src/market/cli/sync-macro.js',
    kind: 'months',
    usage: '[startMonth] [endMonth]',
    description: 'China macro series and US CPI',
  },
  {
    name: 'limit',
    entry: 'src/market/cli/sync-limit.js',
    kind: 'dates',
    usage: '[start] [end]',
    description: 'Daily stock price limits',
  },
  {
    name: 'moneyflow',
    entry: 'src/market/cli/sync-moneyflow.js',
    kind: 'dates',
    usage: '[start] [end]',
    description: 'Stock money flows',
  },
  {
    name: 'sw-industry',
    entry: 'src/market/cli/sync-sw-industry.js',
    kind: 'none',
    usage: '',
    description: 'Shenwan industry membership history',
  },
  {
    name: 'toplist',
    entry: 'src/market/cli/sync-toplist.js',
    kind: 'dates',
    usage: '[start] [end]',
    description: 'Stock top-trading lists',
  },
];
