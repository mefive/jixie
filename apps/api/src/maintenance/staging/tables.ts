/**
 * 显式声明各数据域的发布身份与可变语义，不从用户表自动推断发布范围。
 *
 * Declare domain publication identities and mutation policies explicitly; never infer user-table publication.
 */
export interface MarketTable {
  name: string;
  model: string;
  keys: readonly string[];
  policy: 'mutable' | 'versioned' | 'immutable';
}

function table(
  name: string,
  keys: string[],
  policy: MarketTable['policy'] = 'mutable',
): MarketTable {
  return { name, model: name[0].toLowerCase() + name.slice(1), keys, policy };
}

export const MARKET_TABLES: readonly MarketTable[] = [
  table('TradeCal', ['exchange', 'calDate']),
  table('StockBasic', ['tsCode']),
  table('StockCodeChange', ['oldTsCode']),
  table('StockNameHistory', ['tsCode', 'startDate']),
  table('SwIndustryMember', ['tsCode', 'l1Code', 'inDate']),
  table('EtfBasic', ['tsCode']),
  table('Daily', ['tsCode', 'tradeDate']),
  table('AdjFactor', ['tsCode', 'tradeDate']),
  table('DailyBasic', ['tsCode', 'tradeDate']),
  table('StkLimit', ['tsCode', 'tradeDate']),
  table('Moneyflow', ['tsCode', 'tradeDate']),
  table('TopList', ['tsCode', 'tradeDate']),
  table('EtfDaily', ['tsCode', 'tradeDate']),
  table('EtfAdjFactor', ['tsCode', 'tradeDate']),
  table('EtfShareSize', ['tsCode', 'tradeDate']),
  table('EtfSyncSlice', ['tsCode', 'startDate', 'endDate']),
  table('YieldCurvePoint', ['source', 'curveCode', 'curveType', 'tradeDate', 'termYears']),
  table('FxDaily', ['tsCode', 'tradeDate']),
  table('MacroSeries', ['seriesKey']),
  table('MacroObservation', ['seriesKey', 'period', 'vintageDate']),
  table('MacroReleaseSchedule', ['publishDate', 'title']),
  table('FinaIndicator', ['tsCode', 'endDate']),
  table('FinancialIncomeStatement', ['id'], 'versioned'),
  table('FinancialBalanceSheet', ['id'], 'versioned'),
  table('FinancialCashFlowStatement', ['id'], 'versioned'),
  table('FinancialCorrectionEvidence', ['id']),
  table('Dividend', ['id']),
  table('IndexWeight', ['indexCode', 'conCode', 'tradeDate']),
  table('IndexDaily', ['tsCode', 'tradeDate']),
  table('MarketBenchmark', ['id']),
  table('MarketBenchmarkDaily', ['benchmarkId', 'tradeDate']),
  table('IndexDailyBasic', ['tsCode', 'tradeDate']),
  table('IndexBenchmark', ['tsCode']),
  table('SwIndexDaily', ['tsCode', 'tradeDate']),
  table('MarketIndicator', ['tradeDate']),
  table('IndexIndicator', ['indexCode', 'tradeDate']),
  table('IndustryIndicator', ['l1Code', 'tradeDate']),
  table('FutureContract', ['tsCode']),
  table('FutureDaily', ['tsCode', 'tradeDate']),
  table('FutureMapping', ['continuousCode', 'tradeDate']),
  table('FutureSettlement', ['tsCode', 'tradeDate']),
  table('CommodityWarehouseReceipt', ['productCode', 'tradeDate', 'unit']),
  table('CommodityHoldingPosition', ['productCode', 'tradeDate']),
  table('CommodityContinuousReturn', ['productCode', 'tradeDate']),
  table('FutureMarketPublication', ['tradeDate'], 'immutable'),
];

const DAILY_TABLES = MARKET_TABLES.filter(
  (entry) =>
    ![
      'FinancialIncomeStatement',
      'FinancialBalanceSheet',
      'FinancialCashFlowStatement',
      'FinancialCorrectionEvidence',
      'FinaIndicator',
      'Dividend',
    ].includes(entry.name),
);

const SYNC_TABLES: Record<string, string[]> = {
  'stock-prices': ['StockBasic', 'TradeCal', 'Daily', 'AdjFactor'],
  'stock-history': ['StockBasic', 'StockNameHistory', 'StockCodeChange'],
  basic: ['TradeCal', 'DailyBasic'],
  limit: ['TradeCal', 'StkLimit'],
  moneyflow: ['TradeCal', 'Moneyflow'],
  toplist: ['TradeCal', 'TopList'],
  'sw-industry': ['StockCodeChange', 'SwIndustryMember'],
  fina: [
    'TradeCal',
    'Daily',
    'StockBasic',
    'StockCodeChange',
    'FinaIndicator',
    'FinancialIncomeStatement',
    'FinancialBalanceSheet',
    'FinancialCashFlowStatement',
    'FinancialCorrectionEvidence',
    'Dividend',
  ],
  futures: [
    'TradeCal',
    'FutureContract',
    'FutureDaily',
    'FutureMapping',
    'FutureSettlement',
    'FutureMarketPublication',
  ],
  'commodity-futures': ['TradeCal', 'FutureContract', 'FutureDaily'],
  'commodity-continuous': [
    'TradeCal',
    'FutureContract',
    'FutureDaily',
    'FutureMapping',
    'CommodityContinuousReturn',
  ],
  'commodity-holdings': ['TradeCal', 'FutureContract', 'FutureDaily', 'CommodityHoldingPosition'],
  'commodity-warehouse-receipts': ['TradeCal', 'CommodityWarehouseReceipt'],
  etf: ['TradeCal', 'EtfBasic', 'EtfDaily', 'EtfAdjFactor', 'EtfShareSize', 'EtfSyncSlice'],
  index: ['TradeCal', 'IndexWeight', 'IndexDaily', 'StockCodeChange'],
  'index-daily': ['IndexDaily'],
  'index-basic': ['IndexDailyBasic'],
  'market-reference': ['IndexBenchmark', 'IndexDaily', 'SwIndexDaily', 'TradeCal'],
  rates: ['TradeCal', 'YieldCurvePoint'],
  'credit-curves': ['TradeCal', 'YieldCurvePoint'],
  'external-market': ['TradeCal', 'YieldCurvePoint', 'FxDaily'],
  'cross-market-benchmarks': ['TradeCal', 'MarketBenchmark', 'MarketBenchmarkDaily'],
  macro: ['TradeCal', 'MacroSeries', 'MacroObservation', 'MacroReleaseSchedule'],
  'market-state': [
    'TradeCal',
    'StockBasic',
    'StockNameHistory',
    'StockCodeChange',
    'Daily',
    'AdjFactor',
    'DailyBasic',
    'StkLimit',
    'IndexWeight',
    'IndexDaily',
    'SwIndustryMember',
    'SwIndexDaily',
    'MarketIndicator',
    'IndexIndicator',
    'IndustryIndicator',
  ],
};

export function maintenanceTables(command: string, args: string[]): readonly MarketTable[] {
  if (command === 'daily') {
    return DAILY_TABLES;
  }
  if (
    command === 'weekly' ||
    command === 'repair' ||
    command === 'canonicalize' ||
    command === 'import'
  ) {
    return MARKET_TABLES;
  }
  const names = command === 'sync' ? SYNC_TABLES[args[0]] : undefined;
  if (!names) {
    throw new Error(`No declared staging dependencies for ${command} ${args[0] ?? ''}`);
  }

  // 原始面板变更需带上滚动计算依赖；其他同步只复制自身数据域。
  // Raw panel changes also require rolling-calculation inputs; other syncs copy only their domains.
  const derivedInputs = [
    'Daily',
    'AdjFactor',
    'DailyBasic',
    'StkLimit',
    'IndexWeight',
    'IndexDaily',
    'SwIndustryMember',
    'SwIndexDaily',
    'StockBasic',
    'StockNameHistory',
    'StockCodeChange',
  ];
  const required = new Set(names);
  if (names.some((name) => derivedInputs.includes(name))) {
    for (const name of SYNC_TABLES['market-state']) {
      required.add(name);
    }
  }
  return MARKET_TABLES.filter((entry) => required.has(entry.name));
}
