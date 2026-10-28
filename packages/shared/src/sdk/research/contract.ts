// Explicit public financial-field mapping; no storage schema is inferred.
export const RESEARCH_FINANCIAL_FIELDS_V1 = [
  {
    key: 'income.totalRevenue',
    statementKind: 'income',
    field: 'totalRevenue',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'income.revenue',
    statementKind: 'income',
    field: 'revenue',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'income.operCost',
    statementKind: 'income',
    field: 'operCost',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'income.operateProfit',
    statementKind: 'income',
    field: 'operateProfit',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'income.totalProfit',
    statementKind: 'income',
    field: 'totalProfit',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'income.incomeTax',
    statementKind: 'income',
    field: 'incomeTax',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'income.nIncome',
    statementKind: 'income',
    field: 'nIncome',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'income.nIncomeAttrP',
    statementKind: 'income',
    field: 'nIncomeAttrP',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'income.ebit',
    statementKind: 'income',
    field: 'ebit',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'income.rdExp',
    statementKind: 'income',
    field: 'rdExp',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'income.finExpIntExp',
    statementKind: 'income',
    field: 'finExpIntExp',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'balance_sheet.moneyCap',
    statementKind: 'balance_sheet',
    field: 'moneyCap',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.tradAsset',
    statementKind: 'balance_sheet',
    field: 'tradAsset',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.notesReceiv',
    statementKind: 'balance_sheet',
    field: 'notesReceiv',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.accountsReceiv',
    statementKind: 'balance_sheet',
    field: 'accountsReceiv',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.accountsReceivBill',
    statementKind: 'balance_sheet',
    field: 'accountsReceivBill',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.othReceiv',
    statementKind: 'balance_sheet',
    field: 'othReceiv',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.othRcvTotal',
    statementKind: 'balance_sheet',
    field: 'othRcvTotal',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.inventories',
    statementKind: 'balance_sheet',
    field: 'inventories',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.prepayment',
    statementKind: 'balance_sheet',
    field: 'prepayment',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.contractAssets',
    statementKind: 'balance_sheet',
    field: 'contractAssets',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.othCurAssets',
    statementKind: 'balance_sheet',
    field: 'othCurAssets',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.totalCurAssets',
    statementKind: 'balance_sheet',
    field: 'totalCurAssets',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.fixAssets',
    statementKind: 'balance_sheet',
    field: 'fixAssets',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.fixAssetsTotal',
    statementKind: 'balance_sheet',
    field: 'fixAssetsTotal',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.cip',
    statementKind: 'balance_sheet',
    field: 'cip',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.cipTotal',
    statementKind: 'balance_sheet',
    field: 'cipTotal',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.intanAssets',
    statementKind: 'balance_sheet',
    field: 'intanAssets',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.goodwill',
    statementKind: 'balance_sheet',
    field: 'goodwill',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.deferTaxAssets',
    statementKind: 'balance_sheet',
    field: 'deferTaxAssets',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.othNca',
    statementKind: 'balance_sheet',
    field: 'othNca',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.totalNca',
    statementKind: 'balance_sheet',
    field: 'totalNca',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.totalAssets',
    statementKind: 'balance_sheet',
    field: 'totalAssets',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.notesPayable',
    statementKind: 'balance_sheet',
    field: 'notesPayable',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.acctPayable',
    statementKind: 'balance_sheet',
    field: 'acctPayable',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.accountsPay',
    statementKind: 'balance_sheet',
    field: 'accountsPay',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.advReceipts',
    statementKind: 'balance_sheet',
    field: 'advReceipts',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.contractLiab',
    statementKind: 'balance_sheet',
    field: 'contractLiab',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.payrollPayable',
    statementKind: 'balance_sheet',
    field: 'payrollPayable',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.taxesPayable',
    statementKind: 'balance_sheet',
    field: 'taxesPayable',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.othPayable',
    statementKind: 'balance_sheet',
    field: 'othPayable',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.othPayTotal',
    statementKind: 'balance_sheet',
    field: 'othPayTotal',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.stBorr',
    statementKind: 'balance_sheet',
    field: 'stBorr',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.nonCurLiabDue1y',
    statementKind: 'balance_sheet',
    field: 'nonCurLiabDue1y',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.ltBorr',
    statementKind: 'balance_sheet',
    field: 'ltBorr',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.bondPayable',
    statementKind: 'balance_sheet',
    field: 'bondPayable',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.othCurLiab',
    statementKind: 'balance_sheet',
    field: 'othCurLiab',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.totalCurLiab',
    statementKind: 'balance_sheet',
    field: 'totalCurLiab',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.othNcl',
    statementKind: 'balance_sheet',
    field: 'othNcl',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.totalNcl',
    statementKind: 'balance_sheet',
    field: 'totalNcl',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.totalLiab',
    statementKind: 'balance_sheet',
    field: 'totalLiab',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.minorityInt',
    statementKind: 'balance_sheet',
    field: 'minorityInt',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.totalHldrEqyExcMinInt',
    statementKind: 'balance_sheet',
    field: 'totalHldrEqyExcMinInt',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'balance_sheet.totalShare',
    statementKind: 'balance_sheet',
    field: 'totalShare',
    unit: 'shares',
    semantics: 'stock',
  },
  {
    key: 'cash_flow.nCashflowAct',
    statementKind: 'cash_flow',
    field: 'nCashflowAct',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'cash_flow.cPayAcqConstFiolta',
    statementKind: 'cash_flow',
    field: 'cPayAcqConstFiolta',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'cash_flow.nCashflowInvAct',
    statementKind: 'cash_flow',
    field: 'nCashflowInvAct',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'cash_flow.nCashFlowsFncAct',
    statementKind: 'cash_flow',
    field: 'nCashFlowsFncAct',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'cash_flow.cPayDistDpcpIntExp',
    statementKind: 'cash_flow',
    field: 'cPayDistDpcpIntExp',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'cash_flow.nIncrCashCashEqu',
    statementKind: 'cash_flow',
    field: 'nIncrCashCashEqu',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'cash_flow.cCashEquBegPeriod',
    statementKind: 'cash_flow',
    field: 'cCashEquBegPeriod',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'cash_flow.cCashEquEndPeriod',
    statementKind: 'cash_flow',
    field: 'cCashEquEndPeriod',
    unit: 'CNY',
    semantics: 'stock',
  },
  {
    key: 'cash_flow.netProfit',
    statementKind: 'cash_flow',
    field: 'netProfit',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'cash_flow.deprFaCogaDpba',
    statementKind: 'cash_flow',
    field: 'deprFaCogaDpba',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'cash_flow.amortIntangAssets',
    statementKind: 'cash_flow',
    field: 'amortIntangAssets',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
  {
    key: 'cash_flow.freeCashflow',
    statementKind: 'cash_flow',
    field: 'freeCashflow',
    unit: 'CNY',
    semantics: 'flow_ytd',
  },
] as const;
export type ResearchFinancialFieldV1 = (typeof RESEARCH_FINANCIAL_FIELDS_V1)[number]['key'];
export const RESEARCH_FINANCIAL_PERIODS_V1 = ['reported', 'annual', 'quarterly', 'ttm'] as const;
export type ResearchFinancialPeriodV1 = (typeof RESEARCH_FINANCIAL_PERIODS_V1)[number];

export const RESEARCH_SERIES_ASSET_TYPES_V1 = ['stock', 'etf', 'index'] as const;
export const RESEARCH_SERIES_FREQUENCIES_V1 = ['daily', 'monthly'] as const;
export const RESEARCH_SERIES_TRANSFORMS_V1 = [
  'level',
  'difference',
  'simple_return',
  'percent_change',
  'year_over_year',
] as const;
export const RESEARCH_PARTIAL_PERIOD_POLICIES_V1 = ['exclude', 'include'] as const;
export const RESEARCH_EQUITY_UNIVERSE_SUGGESTIONS_V1 = [
  'cn_a',
  'index:000300.SH',
  'index:000905.SH',
  'index:000852.SH',
] as const;
export const RESEARCH_EQUITY_RISK_WARNING_POLICIES_V1 = ['exclude', 'include'] as const;
export const RESEARCH_PANEL_FREQUENCIES_V1 = ['month_end'] as const;
export const RESEARCH_FINANCIAL_METRICS_V1 = [
  'revenue',
  'revenueGrowthYoY',
  'revenueCagr3y',
  'grossMargin',
  'operatingProfit',
  'ebitProxy',
  'operatingMargin',
  'effectiveTaxRate',
  'nopat',
  'nopatMargin',
  'returnOnAssets',
  'returnOnEquity',
  'workingCapital',
  'investedCapital',
  'capitalTurnover',
  'returnOnInvestedCapital',
  'netCapitalExpenditure',
  'changeInWorkingCapital',
  'reinvestment',
  'reinvestmentRate',
  'operatingCashFlow',
  'freeCashFlowToFirm',
  'cashFreeCashFlow',
  'operatingCashFlowToNetIncome',
  'accrualRatio',
  'cashAndEquivalents',
  'interestBearingDebt',
  'netDebt',
  'debtToInvestedCapital',
  'marketCapitalization',
  'enterpriseValue',
  'issuedShares',
] as const;
export type ResearchFinancialMetricV1 = (typeof RESEARCH_FINANCIAL_METRICS_V1)[number];

export type ResearchSdkParameterTypeV1 =
  | 'string'
  | 'date'
  | 'integer'
  | 'number'
  | 'enum'
  | 'dataframe'
  | 'string_or_string_list'
  | 'string_map';

/**
 * 定义 SDK 参数类型、默认值及双语语义，供生成和校验同源。
 *
 * Define parameter types, defaults and bilingual semantics for shared generation and validation.
 */
export interface ResearchSdkParameterContractV1 {
  name: string;
  type: ResearchSdkParameterTypeV1;
  required: boolean;
  keywordOnly: boolean;
  defaultValue?: string | number | null;
  values?: readonly string[];
  suggestedValues?: readonly string[];
  maximumLength?: number;
  maximumItems?: number;
  descriptionZh: string;
  descriptionEn: string;
}

/**
 * 定义 DataFrame 公开列、Python 类型与单位，隔离 Prisma 存储。
 *
 * Define public DataFrame columns, Python types and units independently of Prisma.
 */
export interface ResearchSdkDataFrameColumnContractV1 {
  name: string;
  wireType:
    | 'trade_date'
    | 'nullable_trade_date'
    | 'number'
    | 'nullable_number'
    | 'string'
    | 'nullable_string'
    | 'boolean';
  pythonType: string;
  descriptionZh: string;
  descriptionEn: string;
}

/**
 * 区分数据表、图表及其他公开返回结构，供 stub 与响应校验。
 *
 * Discriminate public result shapes for stubs and response validation.
 */
export type ResearchSdkReturnContractV1 =
  | {
      kind: 'dataframe';
      columns: readonly ResearchSdkDataFrameColumnContractV1[];
    }
  | { kind: 'mapping'; pythonType: 'Mapping[str, Any]' }
  | { kind: 'chart' };

/**
 * 定义公开方法签名、说明与返回列，供 SDK 全链路消费。
 *
 * Define public method signatures, guidance and result columns across SDK consumers.
 */
export interface ResearchSdkFunctionContractV1 {
  qualifiedName: string;
  namespace: string;
  name: string;
  descriptionZh: string;
  descriptionEn: string;
  examples: readonly string[];
  notesZh: readonly string[];
  notesEn: readonly string[];
  parameters: readonly ResearchSdkParameterContractV1[];
  returns: ResearchSdkReturnContractV1;
}

/**
 * 作为 Research SDK 唯一公开契约，驱动补全、Python stub 与宿主校验。
 *
 * Provide the canonical Research SDK contract for completion, Python stubs and host validation.
 */
export interface ResearchSdkContractV1 {
  version: 1;
  runtimeVersion: 'research-py-v1';
  functions: readonly ResearchSdkFunctionContractV1[];
}

const chartFrameParameter = {
  name: 'frame',
  type: 'dataframe',
  required: true,
  keywordOnly: false,
  descriptionZh: '包含图表字段的 pandas DataFrame。',
  descriptionEn: 'The pandas DataFrame containing the chart fields.',
} as const;

const chartXParameter = {
  name: 'x',
  type: 'string',
  required: true,
  keywordOnly: true,
  descriptionZh: '用作横轴的 DataFrame 列名。',
  descriptionEn: 'The DataFrame column used for the x-axis.',
} as const;

const chartTitleParameter = {
  name: 'title',
  type: 'string',
  required: false,
  keywordOnly: true,
  defaultValue: null,
  descriptionZh: '可选图表标题。',
  descriptionEn: 'An optional chart title.',
} as const;

const chartLabelsParameter = {
  name: 'labels',
  type: 'string_map',
  required: false,
  keywordOnly: true,
  defaultValue: null,
  descriptionZh: '列名到显示名称的可选映射。',
  descriptionEn: 'An optional mapping from column names to display labels.',
} as const;

const equityUniverseParameter = {
  name: 'universe',
  type: 'string',
  required: true,
  keywordOnly: false,
  suggestedValues: RESEARCH_EQUITY_UNIVERSE_SUGGESTIONS_V1,
  maximumLength: 120,
  descriptionZh: '股票池：cn_a 或 index:<指数代码>，例如 index:000300.SH。',
  descriptionEn: 'Equity universe: cn_a or index:<index code>, for example index:000300.SH.',
} as const;

const minimumListedDaysParameter = {
  name: 'minimum_listed_days',
  type: 'integer',
  required: false,
  keywordOnly: true,
  defaultValue: 365,
  descriptionZh: '在每个截面日要求的最短上市自然日数，允许 0–36500。',
  descriptionEn: 'Minimum calendar days listed at each cross-section date, from 0 through 36500.',
} as const;

const riskWarningParameter = {
  name: 'risk_warning',
  type: 'enum',
  required: false,
  keywordOnly: true,
  defaultValue: 'exclude',
  values: RESEARCH_EQUITY_RISK_WARNING_POLICIES_V1,
  descriptionZh: '是否排除截面日当时处于风险警示或退市整理状态的股票。',
  descriptionEn:
    'Whether to exclude stocks under risk warning or pending delisting on the cross-section date.',
} as const;

const financialFieldsParameter = {
  name: 'fields',
  type: 'string_or_string_list',
  required: true,
  keywordOnly: true,
  values: RESEARCH_FINANCIAL_FIELDS_V1.map((field) => field.key),
  maximumItems: 16,
  descriptionZh: '一个或最多16个明确映射的科目，使用表名.字段名，例如 income.revenue。',
  descriptionEn:
    'One to 16 explicitly mapped fields, qualified by statement kind, such as income.revenue.',
} as const;
const financialReportRangeParameters = ['report_start', 'report_end'].map((name) => ({
  name,
  type: 'date' as const,
  required: false,
  keywordOnly: true,
  defaultValue: null,
  descriptionZh: '可选报告期末边界（含），YYYYMMDD；不改变 as_of 可得时间。',
  descriptionEn:
    'Optional inclusive reporting-period boundary, YYYYMMDD; does not change as_of availability.',
}));

const financialMetricSelectionParameter = {
  name: 'metrics',
  type: 'string_or_string_list',
  required: true,
  keywordOnly: true,
  values: RESEARCH_FINANCIAL_METRICS_V1,
  suggestedValues: [
    'revenueGrowthYoY',
    'grossMargin',
    'returnOnInvestedCapital',
    'freeCashFlowToFirm',
    'netDebt',
    'enterpriseValue',
  ],
  maximumItems: 8,
  descriptionZh: '一个或至多八个固定财务指标；不接受任意数据库字段名。',
  descriptionEn:
    'One or up to eight governed financial metrics; arbitrary database field names are rejected.',
} as const;

export const RESEARCH_EQUITY_DATAFRAME_COLUMNS_V1 = [
  {
    name: 'date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '实际使用的数据交易日。',
    descriptionEn: 'The actual market-data trading date used.',
  },
  {
    name: 'code',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: '平台稳定股票代码。',
    descriptionEn: 'The stable platform equity identifier.',
  },
  {
    name: 'name',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: '截面日可得的股票名称；历史名称缺失时退化为代码。',
    descriptionEn:
      'The equity name available on the cross-section date, falling back to the code when missing.',
  },
  {
    name: 'close',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '未复权收盘价，人民币。',
    descriptionEn: 'Unadjusted close in CNY.',
  },
  {
    name: 'adjusted_close',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '收盘价乘以当日累计复权因子。',
    descriptionEn: 'Close multiplied by the cumulative adjustment factor on that date.',
  },
  {
    name: 'daily_return_pct',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '相对前收盘价的当日涨跌幅，百分比。',
    descriptionEn: 'Daily percentage change from the previous close.',
  },
  {
    name: 'volume_lot',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '成交量，单位手。',
    descriptionEn: 'Trading volume in lots.',
  },
  {
    name: 'amount_cny_1k',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '成交额，单位千元人民币。',
    descriptionEn: 'Trading amount in CNY 1,000.',
  },
  {
    name: 'pe',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '静态市盈率。',
    descriptionEn: 'Static price-to-earnings ratio.',
  },
  {
    name: 'pe_ttm',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '滚动十二个月市盈率。',
    descriptionEn: 'Trailing-twelve-month price-to-earnings ratio.',
  },
  {
    name: 'pb',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '市净率。',
    descriptionEn: 'Price-to-book ratio.',
  },
  {
    name: 'ps',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '静态市销率。',
    descriptionEn: 'Static price-to-sales ratio.',
  },
  {
    name: 'dividend_yield_pct',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '供应商口径股息率，百分比。',
    descriptionEn: 'Provider-defined dividend yield in percent.',
  },
  {
    name: 'total_market_cap_cny_10k',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '总市值，单位万元人民币。',
    descriptionEn: 'Total market capitalization in CNY 10,000.',
  },
  {
    name: 'float_market_cap_cny_10k',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '流通市值，单位万元人民币。',
    descriptionEn: 'Float market capitalization in CNY 10,000.',
  },
  {
    name: 'turnover_rate_pct',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '按流通股本计算的换手率，百分比。',
    descriptionEn: 'Turnover rate based on float shares, in percent.',
  },
] as const satisfies readonly ResearchSdkDataFrameColumnContractV1[];

const equityFundamentalColumns = [
  {
    name: 'announcement_date',
    wireType: 'nullable_trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '来源公告日期，不等同于当前版本可得日。',
    descriptionEn: 'Source announcement date, distinct from current-version availability.',
  },
  {
    name: 'availability_quality',
    wireType: 'string',
    pythonType: 'string',
    descriptionZh: '当前版本可得性证据；latest_only 不证明捕获前的历史值。',
    descriptionEn: 'Availability evidence; latest_only does not prove values before capture.',
  },
  {
    name: 'observed_at',
    wireType: 'string',
    pythonType: 'string',
    descriptionZh: '此版本实际首次观察时间，ISO 8601。',
    descriptionEn: 'Actual first observation time of this version, ISO 8601.',
  },
  {
    name: 'date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '当前指标版本可用于研究的日期；未知历史版本按实际捕获时间门控。',
    descriptionEn:
      'Availability of the current indicator version; unproven historical versions are gated by actual capture time.',
  },
  {
    name: 'report_period',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '财务报告期末。',
    descriptionEn: 'The financial reporting-period end.',
  },
  ...[
    ['roe_pct', '净资产收益率，百分比。', 'Return on equity in percent.'],
    [
      'roe_waa_pct',
      '加权平均净资产收益率，百分比。',
      'Weighted-average return on equity in percent.',
    ],
    ['roa_pct', '总资产收益率，百分比。', 'Return on assets in percent.'],
    ['gross_profit_margin_pct', '毛利率，百分比。', 'Gross profit margin in percent.'],
    ['net_profit_margin_pct', '净利率，百分比。', 'Net profit margin in percent.'],
    ['debt_to_assets_pct', '资产负债率，百分比。', 'Debt-to-assets ratio in percent.'],
    [
      'revenue_yoy_pct',
      '营业收入同比增速，百分比。',
      'Operating-revenue year-over-year growth in percent.',
    ],
    [
      'net_profit_yoy_pct',
      '归母净利润同比增速，百分比。',
      'Parent-attributable net-profit YoY growth in percent.',
    ],
    [
      'operating_cash_flow_to_profit',
      '经营现金流与营业利润比。',
      'Operating cash flow to operating profit.',
    ],
  ].map(([name, descriptionZh, descriptionEn]) => ({
    name,
    wireType: 'nullable_number' as const,
    pythonType: 'float64',
    descriptionZh,
    descriptionEn,
  })),
] satisfies readonly ResearchSdkDataFrameColumnContractV1[];

export const RESEARCH_FINANCIAL_STATEMENT_COLUMNS_V1 = [
  {
    name: 'as_of_date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '研究估值日；所有来源版本必须在该日或此前可得。',
    descriptionEn: 'Research as-of date; every source version was available on or before it.',
  },
  {
    name: 'code',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: '平台稳定股票代码。',
    descriptionEn: 'Stable platform equity identifier.',
  },
  {
    name: 'applicability',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: 'industrial 或 unknown。',
    descriptionEn: 'industrial or unknown.',
  },
  {
    name: 'report_period',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '财务报告期末。',
    descriptionEn: 'Financial reporting-period end.',
  },
  {
    name: 'statement_kind',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: 'income、balance_sheet 或 cash_flow。',
    descriptionEn: 'income, balance_sheet, or cash_flow.',
  },
  {
    name: 'field',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: '明确映射的财报科目名。',
    descriptionEn: 'Explicitly mapped statement field name.',
  },
  {
    name: 'value',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '科目值；缺失保持为空。',
    descriptionEn: 'Statement value; missing source values remain null.',
  },
  {
    name: 'unit',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: 'CNY 或 shares。',
    descriptionEn: 'CNY or shares.',
  },
  {
    name: 'announcement_date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '来源记录的实际公告日。',
    descriptionEn: 'Actual announcement date recorded for the source row.',
  },
  {
    name: 'available_date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '该版本首次允许进入研究的日期。',
    descriptionEn: 'First date on which this version may enter research.',
  },
  {
    name: 'availability_quality',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: 'exact 或 conservative；严格 PIT 不返回 reconstructed。',
    descriptionEn: 'exact or conservative; strict PIT never returns reconstructed rows.',
  },
  {
    name: 'report_type',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: '供应商报表类型；调整后口径优先级高于同日正式口径。',
    descriptionEn: 'Provider report type; adjusted values outrank same-day formal values.',
  },
  {
    name: 'source_row_fingerprint',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: '不可变来源行指纹。',
    descriptionEn: 'Immutable source-row fingerprint.',
  },
] as const satisfies readonly ResearchSdkDataFrameColumnContractV1[];

export const RESEARCH_FINANCIAL_VALUE_COLUMNS_V1 = [
  ...RESEARCH_FINANCIAL_STATEMENT_COLUMNS_V1.filter(
    (column) =>
      ![
        'report_period',
        'announcement_date',
        'available_date',
        'availability_quality',
        'report_type',
        'source_row_fingerprint',
      ].includes(column.name),
  ),
  ...['report_period', 'available_date'].map((name) => ({
    name,
    wireType: 'nullable_trade_date' as const,
    pythonType: 'datetime64[ns]',
    descriptionZh: '报告期末或全部计算输入最晚可得日；缺失时为空。',
    descriptionEn:
      'Reporting-period end or latest availability of all calculation inputs; nullable when missing.',
  })),
  ...[
    [
      'period_basis',
      'reported、annual、quarterly、ttm或point_in_time。',
      'reported, annual, quarterly, ttm, or point_in_time.',
    ],
    ['status', 'ok或missing；保留失败行。', 'ok or missing; failed observations remain visible.'],
    ['formula', '公开的口径转换公式。', 'Explicit period-conversion formula.'],
    [
      'formula_version',
      '口径转换版本financial-values-v1。',
      'Period-conversion version financial-values-v1.',
    ],
    ['input_versions_json', '输入来源指纹的JSON数组。', 'JSON array of input source fingerprints.'],
  ].map(([name, descriptionZh, descriptionEn]) => ({
    name,
    wireType: 'string' as const,
    pythonType: 'str',
    descriptionZh,
    descriptionEn,
  })),
  {
    name: 'missing_reason',
    wireType: 'nullable_string',
    pythonType: 'str | None',
    descriptionZh: '缺失、版本歧义或来源未接入的原因。',
    descriptionEn: 'Reason for missing data, ambiguous versions, or an unintegrated source.',
  },
] satisfies readonly ResearchSdkDataFrameColumnContractV1[];

export const RESEARCH_FINANCIAL_METRIC_COLUMNS_V1 = [
  {
    name: 'date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '计算所使用的研究估值日或面板截面日。',
    descriptionEn: 'Research as-of date or panel cross-section date used for calculation.',
  },
  {
    name: 'code',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: '平台稳定股票代码。',
    descriptionEn: 'Stable platform equity identifier.',
  },
  {
    name: 'name',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: '截面日可得名称；单股读取缺少历史名称时退化为代码。',
    descriptionEn: 'Name available on the date, falling back to the code when unavailable.',
  },
  {
    name: 'applicability',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: 'industrial 或 unknown。',
    descriptionEn: 'industrial or unknown.',
  },
  {
    name: 'report_period',
    wireType: 'nullable_trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '指标对应的财务报告期末。',
    descriptionEn: 'Financial reporting-period end used by the metric.',
  },
  {
    name: 'metric',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: '固定的 M2 财务指标标识。',
    descriptionEn: 'Stable M2 financial metric identifier.',
  },
  {
    name: 'value',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '指标值；必须结合 unit 和 status 解读。',
    descriptionEn: 'Metric value; interpret together with unit and status.',
  },
  {
    name: 'unit',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: 'CNY、shares 或 ratio；ratio 的 1 表示 100%。',
    descriptionEn: 'CNY, shares, or ratio; ratio 1 means 100%.',
  },
  {
    name: 'status',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: 'ok、missing、invalid 或 not_applicable。',
    descriptionEn: 'ok, missing, invalid, or not_applicable.',
  },
  {
    name: 'missing_reason',
    wireType: 'nullable_string',
    pythonType: 'str | None',
    descriptionZh: '缺失或无效时的机器可读原因。',
    descriptionEn: 'Machine-readable reason when the metric is missing or invalid.',
  },
  {
    name: 'formula',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: '本次计算采用的明文公式。',
    descriptionEn: 'Human-readable formula used for this calculation.',
  },
  {
    name: 'formula_version',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: '确定性的财务公式版本。',
    descriptionEn: 'Deterministic financial formula version.',
  },
  {
    name: 'input_versions_json',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: '参与计算的来源行指纹 JSON 数组。',
    descriptionEn: 'JSON array of source-row fingerprints used by the calculation.',
  },
] as const satisfies readonly ResearchSdkDataFrameColumnContractV1[];

const equityDividendColumns = [
  {
    name: 'ex_date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '经济除权日期，不证明当前版本历史可得。',
    descriptionEn:
      'Economic ex-dividend date, not proof of historical availability of the current version.',
  },
  {
    name: 'availability_quality',
    wireType: 'string',
    pythonType: 'string',
    descriptionZh: '来源版本可得性证据。',
    descriptionEn: 'Availability evidence for the source version.',
  },
  {
    name: 'observed_at',
    wireType: 'string',
    pythonType: 'string',
    descriptionZh: '当前值首次实际捕获时间。',
    descriptionEn: 'Actual first capture of the current value.',
  },
  {
    name: 'date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '实施分红当前版本的可得日，不早于经济除权日和实际捕获。',
    descriptionEn:
      'Availability of the retained distribution version, no earlier than its ex-date and actual capture.',
  },
  {
    name: 'report_period',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '分红所属报告期。',
    descriptionEn: 'The reporting period to which the distribution belongs.',
  },
  {
    name: 'announcement_date',
    wireType: 'nullable_string',
    pythonType: 'str | None',
    descriptionZh: '来源公告日。',
    descriptionEn: 'The source announcement date.',
  },
  {
    name: 'cash_dividend_pre_tax',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '每股税前现金分红。',
    descriptionEn: 'Pre-tax cash dividend per share.',
  },
  {
    name: 'cash_dividend_tax_basis',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '来源含税口径每股现金分红。',
    descriptionEn: 'Provider tax-basis cash dividend per share.',
  },
] as const satisfies readonly ResearchSdkDataFrameColumnContractV1[];

const etfShareColumns = [
  {
    name: 'date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '该条 ETF 份额记录首次可用于中国市场研究的日期。',
    descriptionEn:
      'The first China-market research date on which the ETF share record is available.',
  },
  {
    name: 'trade_date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '来源交易日。',
    descriptionEn: 'Source trading date.',
  },
  ...[
    ['total_share_10k', 'ETF 总份额，单位万份。', 'Total ETF shares in 10,000 fund units.'],
    ['total_size_cny_10k', 'ETF 总规模，单位万元。', 'Total ETF size in CNY 10,000.'],
    ['nav', '单位净值。', 'Net asset value per fund unit.'],
    ['close', '交易所收盘价。', 'Exchange close price.'],
  ].map(([name, descriptionZh, descriptionEn]) => ({
    name,
    wireType: name === 'total_share_10k' ? ('number' as const) : ('nullable_number' as const),
    pythonType: 'float64',
    descriptionZh,
    descriptionEn,
  })),
  {
    name: 'exchange',
    wireType: 'string',
    pythonType: 'string',
    descriptionZh: '交易所代码。',
    descriptionEn: 'Exchange code.',
  },
] satisfies readonly ResearchSdkDataFrameColumnContractV1[];

const indexValuationColumns = [
  {
    name: 'date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '指数估值交易日。',
    descriptionEn: 'Index valuation trading date.',
  },
  ...[
    ['total_mv_cny', '指数总市值，单位人民币元。', 'Index total market value in CNY.'],
    ['float_mv_cny', '指数流通市值，单位人民币元。', 'Index float market value in CNY.'],
    ['total_share', '指数口径总股本。', 'Provider index total-share measure.'],
    ['float_share', '指数口径流通股本。', 'Provider index float-share measure.'],
    ['free_share', '指数口径自由流通股本。', 'Provider index free-float share measure.'],
    ['turnover_rate_pct', '换手率，百分比。', 'Turnover rate in percentage points.'],
    [
      'turnover_rate_free_float_pct',
      '自由流通口径换手率，百分比。',
      'Free-float turnover rate in percentage points.',
    ],
    ['pe', '指数静态市盈率。', 'Provider index price-to-earnings ratio.'],
    ['pe_ttm', '指数滚动市盈率。', 'Provider index trailing price-to-earnings ratio.'],
    ['pb', '指数市净率。', 'Provider index price-to-book ratio.'],
  ].map(([name, descriptionZh, descriptionEn]) => ({
    name,
    wireType: 'nullable_number' as const,
    pythonType: 'float64',
    descriptionZh,
    descriptionEn,
  })),
] satisfies readonly ResearchSdkDataFrameColumnContractV1[];

/**
 * 为带日期和标识的数据集构造公开 SDK 契约。
 *
 * Construct a public SDK contract for a dated identifier dataset.
 */
function datedIdentifierDatasetFunction(
  name: 'equity_fundamentals' | 'equity_dividends',
  descriptionZh: string,
  descriptionEn: string,
  columns: readonly ResearchSdkDataFrameColumnContractV1[],
): ResearchSdkFunctionContractV1 {
  return {
    qualifiedName: `data.${name}`,
    namespace: 'data',
    name,
    descriptionZh,
    descriptionEn,
    examples: [`data.${name}("600519.SH", start="20200101", end="20251231")`],
    notesZh: ['identifier 使用平台股票代码；start/end 始终约束研究可得日。'],
    notesEn: ['identifier uses the platform stock code; start/end always constrain availability.'],
    parameters: [
      {
        name: 'identifier',
        type: 'string',
        required: true,
        keywordOnly: false,
        maximumLength: 80,
        descriptionZh: '平台股票代码。',
        descriptionEn: 'The platform stock identifier.',
      },
      {
        name: 'start',
        type: 'date',
        required: true,
        keywordOnly: true,
        descriptionZh: '研究可得日起始日期，格式 YYYYMMDD。',
        descriptionEn: 'Inclusive availability start date in YYYYMMDD format.',
      },
      {
        name: 'end',
        type: 'date',
        required: true,
        keywordOnly: true,
        descriptionZh: '研究可得日结束日期，格式 YYYYMMDD。',
        descriptionEn: 'Inclusive availability end date in YYYYMMDD format.',
      },
    ],
    returns: { kind: 'dataframe', columns },
  };
}

/**
 * 为市场参考数据生成参数、结果列及双语说明契约。
 *
 * Construct market-reference method arguments, result columns and bilingual guidance.
 */
function referenceDatasetFunction(
  name: 'etf_shares' | 'index_valuation',
  descriptionZh: string,
  descriptionEn: string,
  exampleIdentifier: string,
  identifierDescriptionZh: string,
  identifierDescriptionEn: string,
  dateBasisZh: string,
  dateBasisEn: string,
  columns: readonly ResearchSdkDataFrameColumnContractV1[],
): ResearchSdkFunctionContractV1 {
  return {
    qualifiedName: `data.${name}`,
    namespace: 'data',
    name,
    descriptionZh,
    descriptionEn,
    examples: [`data.${name}("${exampleIdentifier}", start="20200101", end="20251231")`],
    notesZh: [`identifier ${identifierDescriptionZh}；start/end 约束${dateBasisZh}。`],
    notesEn: [`identifier ${identifierDescriptionEn}; start/end constrain ${dateBasisEn}.`],
    parameters: [
      {
        name: 'identifier',
        type: 'string',
        required: true,
        keywordOnly: false,
        maximumLength: 80,
        descriptionZh: identifierDescriptionZh,
        descriptionEn: identifierDescriptionEn,
      },
      {
        name: 'start',
        type: 'date',
        required: true,
        keywordOnly: true,
        descriptionZh: `起始${dateBasisZh}，格式 YYYYMMDD。`,
        descriptionEn: `Inclusive ${dateBasisEn} start in YYYYMMDD format.`,
      },
      {
        name: 'end',
        type: 'date',
        required: true,
        keywordOnly: true,
        descriptionZh: `结束${dateBasisZh}，格式 YYYYMMDD。`,
        descriptionEn: `Inclusive ${dateBasisEn} end in YYYYMMDD format.`,
      },
    ],
    returns: { kind: 'dataframe', columns },
  };
}

/**
 * 为图表方法构造公开参数和产物契约，供补全与宿主校验。
 *
 * Construct public chart method and artifact contracts for completion and host validation.
 */
function chartFunction(
  name: 'line' | 'area' | 'bar' | 'scatter' | 'event_path',
  descriptionZh: string,
  descriptionEn: string,
  yType: 'string' | 'string_or_string_list',
): ResearchSdkFunctionContractV1 {
  return {
    qualifiedName: `charts.${name}`,
    namespace: 'charts',
    name,
    descriptionZh,
    descriptionEn,
    examples: [
      `charts.${name}(frame, x="date", y=${
        yType === 'string' ? '"value"' : '["value", "benchmark"]'
      }, title="Research chart")`,
    ],
    notesZh: ['frame 必须包含 x、y 和 labels 中引用的 DataFrame 列。'],
    notesEn: ['The frame must contain every DataFrame column referenced by x, y, and labels.'],
    parameters: [
      chartFrameParameter,
      chartXParameter,
      {
        name: 'y',
        type: yType,
        required: true,
        keywordOnly: true,
        descriptionZh:
          yType === 'string'
            ? '用作纵轴的 DataFrame 列名。'
            : '用作纵轴的一列或多列 DataFrame 列名。',
        descriptionEn:
          yType === 'string'
            ? 'The DataFrame column used for the y-axis.'
            : 'One or more DataFrame columns used for the y-axis.',
      },
      chartTitleParameter,
      chartLabelsParameter,
    ],
    returns: { kind: 'chart' },
  };
}

export const RESEARCH_SDK_CONTRACT_V1 = {
  version: 1,
  runtimeVersion: 'research-py-v1',
  functions: [
    {
      qualifiedName: 'data.series',
      namespace: 'data',
      name: 'series',
      descriptionZh: '加载平台口径一致的历史时间序列，返回按日期排序的 pandas DataFrame。',
      descriptionEn:
        'Load a platform-governed historical series as a date-sorted pandas DataFrame.',
      examples: [
        'data.series("index", "000300.SH", start="20200101", end="20251231", frequency="monthly", transform="simple_return")',
      ],
      notesZh: [
        'identifier 与 measure 必须来自研究目录，不能用相似资产或指标静默替代。',
        '月频默认排除尚未结束的部分月份；返回列固定为 date 与 value。',
      ],
      notesEn: [
        'Resolve identifier and measure through the research catalog; never silently substitute a similar asset or measure.',
        'Monthly output excludes an incomplete ending month by default; the fixed columns are date and value.',
      ],
      parameters: [
        {
          name: 'asset_type',
          type: 'enum',
          required: true,
          keywordOnly: false,
          values: RESEARCH_SERIES_ASSET_TYPES_V1,
          descriptionZh: '资产类别。',
          descriptionEn: 'The asset class.',
        },
        {
          name: 'identifier',
          type: 'string',
          required: true,
          keywordOnly: false,
          maximumLength: 80,
          descriptionZh: '平台可识别的稳定证券代码。',
          descriptionEn: 'A stable instrument identifier recognized by the platform.',
        },
        {
          name: 'start',
          type: 'date',
          required: true,
          keywordOnly: true,
          descriptionZh: '起始日期，格式为 YYYYMMDD。',
          descriptionEn: 'The inclusive start date in YYYYMMDD format.',
        },
        {
          name: 'end',
          type: 'date',
          required: true,
          keywordOnly: true,
          descriptionZh: '结束日期，格式为 YYYYMMDD。',
          descriptionEn: 'The inclusive end date in YYYYMMDD format.',
        },
        {
          name: 'measure',
          type: 'enum',
          values: ['market.adjusted_close'],
          required: false,
          keywordOnly: true,
          defaultValue: 'market.adjusted_close',
          maximumLength: 120,
          descriptionZh: '研究目录中的版本化指标标识。',
          descriptionEn: 'A versioned measure identifier from the research catalog.',
        },
        {
          name: 'frequency',
          type: 'enum',
          required: false,
          keywordOnly: true,
          defaultValue: 'daily',
          values: RESEARCH_SERIES_FREQUENCIES_V1,
          descriptionZh: '输出频率。',
          descriptionEn: 'The output frequency.',
        },
        {
          name: 'transform',
          type: 'enum',
          required: false,
          keywordOnly: true,
          defaultValue: 'level',
          values: RESEARCH_SERIES_TRANSFORMS_V1,
          descriptionZh: '应用于序列的确定性变换。',
          descriptionEn: 'The deterministic transform applied to the series.',
        },
        {
          name: 'partial_period',
          type: 'enum',
          required: false,
          keywordOnly: true,
          defaultValue: 'exclude',
          values: RESEARCH_PARTIAL_PERIOD_POLICIES_V1,
          descriptionZh: '是否包含尚未结束的聚合周期。',
          descriptionEn: 'Whether to include an incomplete aggregate period.',
        },
      ],
      returns: {
        kind: 'dataframe',
        columns: [
          {
            name: 'date',
            wireType: 'trade_date',
            pythonType: 'datetime64[ns]',
            descriptionZh: '观测日期；进入 Python 后转换为 pandas datetime。',
            descriptionEn: 'Observation date, converted to pandas datetime in Python.',
          },
          {
            name: 'value',
            wireType: 'number',
            pythonType: 'float64',
            descriptionZh: '按所选指标、频率和变换得到的数值。',
            descriptionEn: 'The value produced by the selected measure, frequency, and transform.',
          },
        ],
      },
    },
    {
      qualifiedName: 'data.cross_section',
      namespace: 'data',
      name: 'cross_section',
      descriptionZh: '读取一个请求日期上实际可得的 A 股 PIT 截面，返回固定列的 pandas DataFrame。',
      descriptionEn:
        'Load the actually available point-in-time China A-share cross-section for one requested date as a fixed-schema pandas DataFrame.',
      examples: [
        'data.cross_section("index:000300.SH", date="20251231", minimum_listed_days=365, risk_warning="exclude")',
      ],
      notesZh: [
        '指数股票池按请求日当时可得的历史成分解析，不用当前成分回填过去。',
        '请求日无截面时返回此前最近可用数据日；实际 date 必须从结果列读取。',
      ],
      notesEn: [
        'Index universes resolve historical membership available on the requested date; current membership is never backfilled into the past.',
        'When the requested date has no snapshot, the latest prior data date is returned and must be read from the date column.',
      ],
      parameters: [
        equityUniverseParameter,
        {
          name: 'date',
          type: 'date',
          required: true,
          keywordOnly: true,
          descriptionZh: '请求日期，格式为 YYYYMMDD；无截面时使用此前最近数据日并披露。',
          descriptionEn:
            'Requested date in YYYYMMDD; the latest prior data date is used and disclosed when necessary.',
        },
        minimumListedDaysParameter,
        riskWarningParameter,
      ],
      returns: { kind: 'dataframe', columns: RESEARCH_EQUITY_DATAFRAME_COLUMNS_V1 },
    },
    {
      qualifiedName: 'data.panel',
      namespace: 'data',
      name: 'panel',
      descriptionZh: '按历史 PIT 股票池规则读取多个完整月末截面，返回 date × code 固定列长表。',
      descriptionEn:
        'Load complete month-end point-in-time equity cross-sections as a fixed-schema date-by-code long DataFrame.',
      examples: [
        'data.panel("index:000300.SH", start="20200101", end="20251231", frequency="month_end", minimum_listed_days=365, risk_warning="exclude")',
      ],
      notesZh: [
        '指数股票池在每个月末分别按当时可得的历史成分解析，不用当前成分回填历史。',
        'V1 只支持完整月末；未完成的结束月份不会进入结果。',
        '返回固定 date × code 长表，用于探索；正式因子证据仍由 FactorReport 产生。',
      ],
      notesEn: [
        'Index universes resolve point-in-time historical membership separately at every month end; current membership is never backfilled.',
        'V1 supports completed month ends only; an incomplete ending month is excluded.',
        'The fixed date-by-code long frame is exploratory; FactorReport remains the formal factor-evidence surface.',
      ],
      parameters: [
        equityUniverseParameter,
        {
          name: 'start',
          type: 'date',
          required: true,
          keywordOnly: true,
          descriptionZh: '起始日期，格式为 YYYYMMDD。',
          descriptionEn: 'Inclusive start date in YYYYMMDD format.',
        },
        {
          name: 'end',
          type: 'date',
          required: true,
          keywordOnly: true,
          descriptionZh: '结束日期，格式为 YYYYMMDD；未完成月份不会进入结果。',
          descriptionEn: 'Inclusive end date in YYYYMMDD; an incomplete ending month is excluded.',
        },
        {
          name: 'frequency',
          type: 'enum',
          required: false,
          keywordOnly: true,
          defaultValue: 'month_end',
          values: RESEARCH_PANEL_FREQUENCIES_V1,
          descriptionZh: '截面频率；首版只允许完整月末。',
          descriptionEn: 'Cross-section frequency; V1 supports completed month ends only.',
        },
        minimumListedDaysParameter,
        riskWarningParameter,
      ],
      returns: { kind: 'dataframe', columns: RESEARCH_EQUITY_DATAFRAME_COLUMNS_V1 },
    },
    {
      qualifiedName: 'results.factor_report',
      namespace: 'results',
      name: 'factor_report',
      descriptionZh: '按报告 ID 读取当前用户已完成且可见的不可变 FactorReport 结果。',
      descriptionEn:
        'Load one completed, visible, immutable FactorReport result owned by the current user.',
      examples: [
        'report = results.factor_report("01K5EXAMPLEFACTORREPORT")',
        'rank_ic_mean = report["report"]["ic_mean"]',
      ],
      notesZh: [
        '返回顶层字段包括 report_id、factor、analysis_kind、research_spec、lineage 与 report。',
        'report 与 research_spec 的字段使用 snake_case；原报告快照不会被修改或重新运行。',
        '仅可读取当前研究文档所属用户已完成的报告。',
        '每个因子保留最近分析及发布绑定报告；旧的普通报告会被清理，失效 ID 明确报错。',
      ],
      notesEn: [
        'Top-level keys include report_id, factor, analysis_kind, research_spec, lineage, and report.',
        'The report and research_spec fields use snake_case; the frozen report is neither mutated nor rerun.',
        'Only completed reports owned by the current Research document user are readable.',
        'Each factor retains the latest analysis and publication-bound reports; removed ordinary report IDs fail explicitly.',
      ],
      parameters: [
        {
          name: 'report_id',
          type: 'string',
          required: true,
          keywordOnly: false,
          maximumLength: 512,
          descriptionZh: 'Factor 当前报告或保留报告链接中的稳定报告 ID。',
          descriptionEn: 'The stable report ID from a current or retained Factor report link.',
        },
      ],
      returns: { kind: 'mapping', pythonType: 'Mapping[str, Any]' },
    },
    {
      qualifiedName: 'results.backtest_report',
      namespace: 'results',
      name: 'backtest_report',
      descriptionZh: '按报告 ID 读取当前用户已完成的保留的 BacktestReport 结果。',
      descriptionEn: 'Load one completed retained BacktestReport result owned by the current user.',
      examples: [
        'report = results.backtest_report("01K5EXAMPLEBACKTESTREPORT")',
        'sharpe = report["report"]["sharpe"]',
      ],
      notesZh: [
        '返回顶层字段包括 report_id、strategy_id、strategy_name、backtest_spec 与 report。',
        'report 与 backtest_spec 的字段使用 snake_case；仅保留最近结果；再次提交后旧 ID 会失效。不返回源码。',
        '只允许读取当前用户已完成且带结果的报告。',
      ],
      notesEn: [
        'Top-level keys include report_id, strategy_id, strategy_name, backtest_spec and report.',
        'The report and backtest_spec fields use snake_case; only the latest result is retained; resubmission invalidates old IDs. Source is not returned.',
        'Only completed reports with results owned by the current user can be loaded.',
      ],
      parameters: [
        {
          name: 'report_id',
          type: 'string',
          required: true,
          keywordOnly: false,
          maximumLength: 512,
          descriptionZh: 'Research 数据目录中的当前保留的 BacktestReport ID。',
          descriptionEn: 'The retained BacktestReport ID from the Research data catalog.',
        },
      ],
      returns: { kind: 'mapping', pythonType: 'Mapping[str, Any]' },
    },
    datedIdentifierDatasetFunction(
      'equity_fundamentals',
      '按公告日读取单只股票的财务指标历史。',
      'Load retained stock financial-indicator versions by actual availability date.',
      equityFundamentalColumns,
    ),
    datedIdentifierDatasetFunction(
      'equity_dividends',
      '按除权除息日读取单只股票已实施的现金分红。',
      'Load captured implemented dividends by version availability, retaining economic ex-dates.',
      equityDividendColumns,
    ),
    {
      qualifiedName: 'results.strategy_scan_report',
      namespace: 'results',
      name: 'strategy_scan_report',
      descriptionZh: '按报告 ID 读取当前用户已完成的保留的策略参数扫描结果。',
      descriptionEn:
        'Load one completed retained strategy parameter-scan result owned by the current user.',
      examples: ['scan = results.strategy_scan_report("01K5EXAMPLESCANREPORT")'],
      notesZh: [
        '返回不含源码的 settings、spec、逐组合指标和数据截止日；仅保留最近扫描，再次提交后旧 ID 会失效。',
      ],
      notesEn: [
        'Returns settings without source, spec, per-combination metrics and data cutoff. Only the latest scan is retained; resubmission invalidates old IDs.',
      ],
      parameters: [
        {
          name: 'report_id',
          type: 'string',
          required: true,
          keywordOnly: false,
          maximumLength: 512,
          descriptionZh: '策略最近扫描的报告 ID。',
          descriptionEn: 'The retained report ID from the latest strategy scan.',
        },
      ],
      returns: { kind: 'mapping', pythonType: 'Mapping[str, Any]' },
    },
    referenceDatasetFunction(
      'etf_shares',
      '按研究可得日读取 ETF 份额、规模、净值与收盘价。',
      'Load ETF shares, size, NAV, and close by research availability date.',
      '510300.SH',
      '使用平台 ETF 代码',
      'uses a platform ETF code',
      '研究可得日',
      'research availability date',
      etfShareColumns,
    ),
    referenceDatasetFunction(
      'index_valuation',
      '读取供应商直接计算的指数估值、市值与换手指标。',
      'Load provider-computed index valuation, market value, and turnover measures.',
      '000300.SH',
      '使用平台指数代码',
      'uses a platform index code',
      '交易日',
      'trading date',
      indexValuationColumns,
    ),
    {
      qualifiedName: 'data.equity_financial_statements',
      namespace: 'data',
      name: 'equity_financial_statements',
      descriptionZh: '按一个历史估值日读取单只股票当时可用的版本化三张财报。',
      descriptionEn:
        'Load the versioned three-statement state actually available for one equity on a historical as-of date.',
      examples: ['data.equity_financial_statements("000858.SZ", as_of="20240429")'],
      notesZh: [
        '返回 report_period × statement_kind × field 长表；严格 PIT 排除 reconstructed 版本。',
        '数据读取不以 FCFF 模型适用性为门槛；金融企业来源映射尚未接入，无已接入报表时返回空表。',
        'fields 使用表名.字段名，返回 field 列保留原字段名；省略筛选参数时保持原调用语义。',
      ],
      notesEn: [
        'Returns a report_period-by-statement_kind-by-field long frame; strict PIT excludes reconstructed versions.',
        'Reading statements does not require FCFF applicability; financial-sector source mappings are not integrated and return an empty frame when no integrated statements exist.',
        'fields uses statement_kind.field; the returned field column keeps the unqualified field name. Omitted filters preserve existing calls.',
      ],
      parameters: [
        {
          name: 'identifier',
          type: 'string',
          required: true,
          keywordOnly: false,
          maximumLength: 80,
          descriptionZh: '平台 A 股代码。',
          descriptionEn: 'Platform A-share identifier.',
        },
        {
          name: 'as_of',
          type: 'date',
          required: true,
          keywordOnly: true,
          descriptionZh: '历史估值日，格式 YYYYMMDD。',
          descriptionEn: 'Historical research as-of date in YYYYMMDD format.',
        },
        { ...financialFieldsParameter, required: false, defaultValue: null },
        ...financialReportRangeParameters,
      ],
      returns: { kind: 'dataframe', columns: RESEARCH_FINANCIAL_STATEMENT_COLUMNS_V1 },
    },
    {
      qualifiedName: 'data.equity_financial_metrics',
      namespace: 'data',
      name: 'equity_financial_metrics',
      descriptionZh: '按一个历史估值日计算单只股票所有已知报告期的标准化财务指标。',
      descriptionEn:
        'Calculate governed financial metrics for every reporting period known for one equity on a historical as-of date.',
      examples: ['data.equity_financial_metrics("000858.SZ", as_of="20240429")'],
      notesZh: [
        '每行保留公式、公式版本、输入版本和缺失原因；ratio 的 1 表示 100%。',
        '缺季度或必需科目时返回 missing/invalid，不使用未来修订或快捷式补值。',
      ],
      notesEn: [
        'Every row preserves formula, formula version, input versions, and missing reason; ratio 1 means 100%.',
        'Missing quarters or required fields remain missing/invalid without future revisions or shortcut substitutes.',
      ],
      parameters: [
        {
          name: 'identifier',
          type: 'string',
          required: true,
          keywordOnly: false,
          maximumLength: 80,
          descriptionZh: '平台 A 股代码。',
          descriptionEn: 'Platform A-share identifier.',
        },
        {
          name: 'as_of',
          type: 'date',
          required: true,
          keywordOnly: true,
          descriptionZh: '历史估值日，格式 YYYYMMDD。',
          descriptionEn: 'Historical research as-of date in YYYYMMDD format.',
        },
      ],
      returns: { kind: 'dataframe', columns: RESEARCH_FINANCIAL_METRIC_COLUMNS_V1 },
    },
    {
      qualifiedName: 'data.equity_financial_cross_section',
      namespace: 'data',
      name: 'equity_financial_cross_section',
      descriptionZh: '批量计算一个历史 A 股截面上每只股票的最新可用财务指标。',
      descriptionEn:
        'Batch-calculate the latest available financial metrics for every equity in one historical China A-share cross-section.',
      examples: [
        'data.equity_financial_cross_section("index:000300.SH", date="20240429", metrics=["revenue", "returnOnInvestedCapital"])',
      ],
      notesZh: [
        '股票池、市场数据和财报均按截面日 PIT 解析；返回 date × code × metric 长表。',
        '最多选择八个指标且最多返回 50000 行；缺少已接入非金融报表时返回 missing 行。',
      ],
      notesEn: [
        'Universe, market data, and statements all resolve point-in-time on the cross-section date; returns a date-by-code-by-metric long frame.',
        'At most eight metrics and 50,000 rows are allowed; missing integrated non-financial statements produce missing rows.',
      ],
      parameters: [
        equityUniverseParameter,
        {
          name: 'date',
          type: 'date',
          required: true,
          keywordOnly: true,
          descriptionZh: '请求截面日，格式 YYYYMMDD。',
          descriptionEn: 'Requested cross-section date in YYYYMMDD format.',
        },
        financialMetricSelectionParameter,
        minimumListedDaysParameter,
        riskWarningParameter,
      ],
      returns: { kind: 'dataframe', columns: RESEARCH_FINANCIAL_METRIC_COLUMNS_V1 },
    },
    {
      qualifiedName: 'data.equity_financial_panel',
      namespace: 'data',
      name: 'equity_financial_panel',
      descriptionZh: '批量计算多个历史月末股票池的最新可用财务指标。',
      descriptionEn:
        'Batch-calculate the latest available financial metrics across historical month-end equity universes.',
      examples: [
        'data.equity_financial_panel("index:000300.SH", start="20200101", end="20241231", frequency="month_end", metrics=["revenueGrowthYoY", "returnOnInvestedCapital"])',
      ],
      notesZh: [
        '每个月末独立解析当时股票池和财报版本，不用当前成分或最新财报回填历史。',
        '最多选择八个指标且最多返回 100000 行；超限必须缩小股票池、时间或指标。',
      ],
      notesEn: [
        'Every month end independently resolves its historical universe and statement versions; current constituents and latest statements never backfill history.',
        'At most eight metrics and 100,000 rows are allowed; narrow the universe, range, or metrics when exceeded.',
      ],
      parameters: [
        equityUniverseParameter,
        {
          name: 'start',
          type: 'date',
          required: true,
          keywordOnly: true,
          descriptionZh: '起始日期，格式 YYYYMMDD。',
          descriptionEn: 'Inclusive start date in YYYYMMDD format.',
        },
        {
          name: 'end',
          type: 'date',
          required: true,
          keywordOnly: true,
          descriptionZh: '结束日期，格式 YYYYMMDD；未完成月份不会进入。',
          descriptionEn: 'Inclusive end date in YYYYMMDD; incomplete ending months are excluded.',
        },
        {
          name: 'frequency',
          type: 'enum',
          required: false,
          keywordOnly: true,
          defaultValue: 'month_end',
          values: RESEARCH_PANEL_FREQUENCIES_V1,
          descriptionZh: '截面频率；V1 只支持完整月末。',
          descriptionEn: 'Cross-section frequency; V1 supports completed month ends only.',
        },
        financialMetricSelectionParameter,
        minimumListedDaysParameter,
        riskWarningParameter,
      ],
      returns: { kind: 'dataframe', columns: RESEARCH_FINANCIAL_METRIC_COLUMNS_V1 },
    },
    chartFunction(
      'line',
      '创建 jixie 原生交互折线图。',
      'Create a native interactive line chart.',
      'string_or_string_list',
    ),
    chartFunction(
      'area',
      '创建 jixie 原生交互面积图。',
      'Create a native interactive area chart.',
      'string_or_string_list',
    ),
    chartFunction(
      'bar',
      '创建 jixie 原生交互柱状图。',
      'Create a native interactive bar chart.',
      'string_or_string_list',
    ),
    chartFunction(
      'scatter',
      '创建 jixie 原生交互散点图。',
      'Create a native interactive scatter chart.',
      'string',
    ),
    chartFunction(
      'event_path',
      '创建带事件时点标记的 jixie 原生交互路径图。',
      'Create a native interactive event path chart with an event-time marker.',
      'string_or_string_list',
    ),
    {
      qualifiedName: 'charts.histogram',
      namespace: 'charts',
      name: 'histogram',
      descriptionZh: '对数值列确定性分箱，创建 jixie 原生交互直方图。',
      descriptionEn:
        'Deterministically bin a numeric column and create a native interactive histogram.',
      examples: [
        'charts.histogram(frame, column="next_month_return", bins=20, title="Return distribution")',
      ],
      notesZh: ['frame 必须包含 column 和 labels 中引用的 DataFrame 列；bins 允许 1–100。'],
      notesEn: [
        'The frame must contain the DataFrame columns referenced by column and labels; bins accepts 1 through 100.',
      ],
      parameters: [
        chartFrameParameter,
        {
          name: 'column',
          type: 'string',
          required: true,
          keywordOnly: true,
          descriptionZh: '需要观察分布的数值列名。',
          descriptionEn: 'The numeric DataFrame column whose distribution is shown.',
        },
        {
          name: 'bins',
          type: 'integer',
          required: false,
          keywordOnly: true,
          defaultValue: 20,
          descriptionZh: '分箱数量，允许 1–100。',
          descriptionEn: 'The number of bins, from 1 to 100.',
        },
        chartTitleParameter,
        chartLabelsParameter,
      ],
      returns: { kind: 'chart' },
    },
    {
      qualifiedName: 'charts.boxplot',
      namespace: 'charts',
      name: 'boxplot',
      descriptionZh: '按数值列及可选分组计算五数概括，创建 jixie 原生交互箱线图。',
      descriptionEn:
        'Compute five-number summaries by numeric column and optional group for a native interactive box plot.',
      examples: [
        'charts.boxplot(frame, y="next_month_return", group="quintile", title="Return by quintile")',
      ],
      notesZh: ['frame 必须包含 y、group 和 labels 中引用的 DataFrame 列。'],
      notesEn: [
        'The frame must contain every DataFrame column referenced by y, group, and labels.',
      ],
      parameters: [
        chartFrameParameter,
        {
          name: 'y',
          type: 'string_or_string_list',
          required: true,
          keywordOnly: true,
          descriptionZh: '需要比较分布的一列或多列数值列名。',
          descriptionEn: 'One or more numeric DataFrame columns to compare.',
        },
        {
          name: 'group',
          type: 'string',
          required: false,
          keywordOnly: true,
          defaultValue: null,
          descriptionZh: '可选分组列名。',
          descriptionEn: 'An optional grouping column.',
        },
        chartTitleParameter,
        chartLabelsParameter,
      ],
      returns: { kind: 'chart' },
    },
    {
      qualifiedName: 'charts.heatmap',
      namespace: 'charts',
      name: 'heatmap',
      descriptionZh: '用两个分类轴和一个数值列创建 jixie 原生交互热力图。',
      descriptionEn:
        'Create a native interactive heatmap from two categorical axes and one numeric value column.',
      examples: [
        'charts.heatmap(frame, x="year", y="month", value="rank_ic", title="Monthly Rank IC")',
      ],
      notesZh: ['frame 必须包含 x、y、value 和 labels 中引用的 DataFrame 列。'],
      notesEn: [
        'The frame must contain every DataFrame column referenced by x, y, value, and labels.',
      ],
      parameters: [
        chartFrameParameter,
        chartXParameter,
        {
          name: 'y',
          type: 'string',
          required: true,
          keywordOnly: true,
          descriptionZh: '用作纵轴分类的 DataFrame 列名。',
          descriptionEn: 'The DataFrame column used for y-axis categories.',
        },
        {
          name: 'value',
          type: 'string',
          required: true,
          keywordOnly: true,
          descriptionZh: '决定热力颜色的数值列名。',
          descriptionEn: 'The numeric DataFrame column mapped to heatmap color.',
        },
        chartTitleParameter,
        chartLabelsParameter,
      ],
      returns: { kind: 'chart' },
    },
    {
      qualifiedName: 'data.equity_financial_values',
      namespace: 'data',
      name: 'equity_financial_values',
      descriptionZh: '按同一历史可用日批量读取自选财报科目，并选择原报表、年度、单季度或TTM口径。',
      descriptionEn:
        'Read selected financial fields for a bounded stock list at one historical as-of date, with reported, annual, quarterly, or TTM values.',
      examples: [
        'data.equity_financial_values(["000858.SZ", "600519.SH"], as_of="20260506", fields=["income.revenue", "balance_sheet.totalAssets"], report_start="20230101", report_end="20251231", period="annual")',
      ],
      notesZh: [
        '最多100只股票、16个科目、20年报告期及100000行；股票列表由用户选择，不自动构成历史股票池。',
        'annual只选12月年报；quarterly对累计流量做季度差分，ttm复用连续季度内核；缺数不填零。',
        '资产负债表及现金期初/期末余额始终保留原报表时点，不做差分、求和或自动平均，period_basis为point_in_time。',
        '所有输入版本都须在as_of当时可得；这是固定时点的报告期序列，不是各历史月末当时可得的面板。',
        '返回状态、原因、公式、来源版本及可得日；金融企业数据未接入与工业模型不适用是两回事。',
      ],
      notesEn: [
        'At most 100 identifiers, 16 fields, 20 reporting years, and 100000 rows. A user-supplied list is not a historical universe.',
        'annual selects December annual reports; quarterly differences YTD flows; ttm reuses the continuous-quarter kernel. Missing values are never zero-filled.',
        'Balance-sheet and beginning/ending cash stocks retain their reported observation, without differencing, summing, or averaging; period_basis is point_in_time.',
        'Every input must be available by as_of. Reporting-period history at one fixed cutoff is not a historical month-end PIT panel.',
        'Preserves status, reasons, formulas, source versions, and availability. Unintegrated financial-sector data is distinct from industrial-model applicability.',
      ],
      parameters: [
        {
          name: 'identifiers',
          type: 'string_or_string_list',
          required: true,
          keywordOnly: false,
          maximumItems: 100,
          maximumLength: 80,
          descriptionZh: '一只或最多100只A股代码。',
          descriptionEn: 'One or at most 100 A-share identifiers.',
        },
        {
          name: 'as_of',
          type: 'date',
          required: true,
          keywordOnly: true,
          descriptionZh: '历史可用日，YYYYMMDD。',
          descriptionEn: 'Historical availability cutoff, YYYYMMDD.',
        },
        financialFieldsParameter,
        ...financialReportRangeParameters.map((parameter) => ({
          ...parameter,
          required: true,
          defaultValue: undefined,
          descriptionZh: '报告期末边界（含），YYYYMMDD。',
          descriptionEn: 'Inclusive reporting-period boundary, YYYYMMDD.',
        })),
        {
          name: 'period',
          type: 'enum',
          required: false,
          keywordOnly: true,
          defaultValue: 'reported',
          values: RESEARCH_FINANCIAL_PERIODS_V1,
          descriptionZh: '流量计算口径；annual同时仅选择12月年报。',
          descriptionEn: 'Flow basis; annual also selects only December annual reports.',
        },
      ],
      returns: { kind: 'dataframe', columns: RESEARCH_FINANCIAL_VALUE_COLUMNS_V1 },
    },
  ],
} as const satisfies ResearchSdkContractV1;

export const RESEARCH_SERIES_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[0];
export const RESEARCH_CROSS_SECTION_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[1];
export const RESEARCH_PANEL_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[2];
export const RESEARCH_FACTOR_REPORT_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[3];
export const RESEARCH_BACKTEST_REPORT_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[4];
export const RESEARCH_EQUITY_FUNDAMENTALS_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[5];
export const RESEARCH_EQUITY_DIVIDENDS_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[6];
export const RESEARCH_STRATEGY_SCAN_REPORT_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[7];
export const RESEARCH_ETF_SHARES_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[8];
export const RESEARCH_INDEX_VALUATION_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[9];
export const RESEARCH_FINANCIAL_STATEMENTS_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[10];
export const RESEARCH_FINANCIAL_METRICS_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[11];
export const RESEARCH_FINANCIAL_CROSS_SECTION_SDK_CONTRACT_V1 =
  RESEARCH_SDK_CONTRACT_V1.functions[12];
export const RESEARCH_FINANCIAL_PANEL_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[13];

export const RESEARCH_FINANCIAL_VALUES_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions.find(
  (method) => method.qualifiedName === 'data.equity_financial_values',
)!;
