export const RESEARCH_SERIES_ASSET_TYPES_V1 = ['stock', 'etf', 'index', 'future'] as const;
export const RESEARCH_SERIES_FREQUENCIES_V1 = ['daily', 'monthly'] as const;
export const RESEARCH_SERIES_TRANSFORMS_V1 = [
  'level',
  'difference',
  'simple_return',
  'percent_change',
  'year_over_year',
] as const;
export const RESEARCH_YIELD_CURVE_CODES_V1 = [
  'us_treasury_nominal',
  'us_treasury_real',
  'mof_cgb_ytm',
  'chinabond_cgb_ytm',
  'chinabond_bank_aaa_ytm',
  'chinabond_cp_note_aaa_ytm',
] as const;
export const RESEARCH_YIELD_TENORS_V1 = [
  '1M',
  '2M',
  '3M',
  '6M',
  '1Y',
  '2Y',
  '3Y',
  '5Y',
  '7Y',
  '10Y',
  '20Y',
  '30Y',
] as const;
export const RESEARCH_YIELD_TRANSFORMS_V1 = ['level', 'difference'] as const;
export type ResearchYieldCurveCodeV1 = (typeof RESEARCH_YIELD_CURVE_CODES_V1)[number];
export type ResearchYieldTenorV1 = (typeof RESEARCH_YIELD_TENORS_V1)[number];
export type ResearchYieldTransformV1 = (typeof RESEARCH_YIELD_TRANSFORMS_V1)[number];
export const RESEARCH_MACRO_SERIES_KEYS_V1 = [
  'cn_cpi_yoy',
  'cn_ppi_yoy',
  'cn_pmi_manufacturing',
  'cn_social_financing_increment',
  'cn_social_financing_stock',
  'cn_m1_balance',
  'cn_m1_yoy',
  'cn_m2_balance',
  'cn_m2_yoy',
  'cn_shibor_overnight',
  'cn_shibor_1w',
  'cn_shibor_1m',
  'cn_shibor_3m',
  'us_cpi_u_all_items_nsa',
] as const;
export const RESEARCH_FX_SERIES_IDS_V1 = ['USDCNH.FXCM', 'USDHKD.FXCM', 'HKDCNH.DERIVED'] as const;
export type ResearchMacroSeriesKeyV1 = (typeof RESEARCH_MACRO_SERIES_KEYS_V1)[number];
export type ResearchFxSeriesIdV1 = (typeof RESEARCH_FX_SERIES_IDS_V1)[number];
export const RESEARCH_COMMODITY_PRODUCT_CODES_V1 = ['AU', 'CU', 'SC', 'M'] as const;
export const RESEARCH_COMMODITY_HOLDING_PRODUCT_CODES_V1 = ['AU', 'CU', 'M'] as const;
export type ResearchCommodityProductCodeV1 = (typeof RESEARCH_COMMODITY_PRODUCT_CODES_V1)[number];
export type ResearchCommodityHoldingProductCodeV1 =
  (typeof RESEARCH_COMMODITY_HOLDING_PRODUCT_CODES_V1)[number];
export const RESEARCH_MARKET_STATE_SCOPES_V1 = [
  'all',
  '000016.SH',
  '000300.SH',
  '000905.SH',
  '000852.SH',
  '932000.CSI',
  '000510.SH',
  '399006.SZ',
  '000688.SH',
  '000922.CSI',
] as const;
export type ResearchMarketStateScopeV1 = (typeof RESEARCH_MARKET_STATE_SCOPES_V1)[number];
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
  | 'enum'
  | 'dataframe'
  | 'string_or_string_list'
  | 'string_map';

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

export type ResearchSdkReturnContractV1 =
  | {
      kind: 'dataframe';
      columns: readonly ResearchSdkDataFrameColumnContractV1[];
    }
  | { kind: 'mapping'; pythonType: 'Mapping[str, Any]' }
  | { kind: 'chart' };

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
    name: 'industry',
    wireType: 'nullable_string',
    pythonType: 'str | None',
    descriptionZh: '截面日的申万一级行业；缺少历史归属时为空。',
    descriptionEn:
      'The point-in-time SW level-1 industry, or null when historical membership is unavailable.',
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

const commodityIdentityColumns = [
  {
    name: 'date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '该观测首次可用于研究的日期。',
    descriptionEn: 'The first date on which the observation is available to research.',
  },
  {
    name: 'trade_date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '来源市场交易日。',
    descriptionEn: 'The source-market trading date.',
  },
  {
    name: 'product',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: '商品品种代码。',
    descriptionEn: 'The commodity product code.',
  },
] as const satisfies readonly ResearchSdkDataFrameColumnContractV1[];

export const RESEARCH_COMMODITY_RETURN_COLUMNS_V1 = [
  ...commodityIdentityColumns,
  {
    name: 'continuous_code',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: '研究用连续合约代码。',
    descriptionEn: 'The research-only continuous contract code.',
  },
  {
    name: 'mapped_contract',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: '当日确定性映射的实际合约。',
    descriptionEn: 'The actual contract selected by the deterministic mapping.',
  },
  ...[
    ['continuous_return', '连续结算收益率。', 'Continuous settlement return.'],
    ['continuous_log_return', '连续结算对数收益率。', 'Continuous settlement log return.'],
    [
      'mapped_log_return',
      '映射合约切换前后的对数收益。',
      'Mapped-contract log return across the interval.',
    ],
    [
      'roll_gap_log_return',
      '换月代码切换带来的对数价差。',
      'Log price gap caused by a contract-code change.',
    ],
    [
      'roll_yield_proxy',
      '与换月价差反号的期限结构代理。',
      'Opposite-signed roll-gap term-structure proxy.',
    ],
  ].map(([name, descriptionZh, descriptionEn]) => ({
    name,
    wireType: 'number' as const,
    pythonType: 'float64',
    descriptionZh,
    descriptionEn,
  })),
  {
    name: 'mapping_changed',
    wireType: 'boolean',
    pythonType: 'bool',
    descriptionZh: '当日是否发生映射合约切换。',
    descriptionEn: 'Whether the mapped contract changed on that date.',
  },
] satisfies readonly ResearchSdkDataFrameColumnContractV1[];

export const RESEARCH_COMMODITY_WAREHOUSE_RECEIPT_COLUMNS_V1 = [
  ...commodityIdentityColumns,
  {
    name: 'unit',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: '交易所报告单位。',
    descriptionEn: 'The exchange-reported unit.',
  },
  {
    name: 'volume',
    wireType: 'number',
    pythonType: 'float64',
    descriptionZh: '仓单总量。',
    descriptionEn: 'Total warehouse-receipt volume.',
  },
  {
    name: 'volume_change',
    wireType: 'nullable_number',
    pythonType: 'float64',
    descriptionZh: '相对上次报告的仓单变化量。',
    descriptionEn: 'Warehouse-receipt change from the previous report.',
  },
  {
    name: 'unit_correction_applied',
    wireType: 'boolean',
    pythonType: 'bool',
    descriptionZh: '是否应用过审计确认的单位修正。',
    descriptionEn: 'Whether an audited unit correction was applied.',
  },
] as const satisfies readonly ResearchSdkDataFrameColumnContractV1[];

export const RESEARCH_COMMODITY_HOLDING_COLUMNS_V1 = [
  ...commodityIdentityColumns,
  {
    name: 'reference_contract',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: '当日持仓排名对应的实际代表合约。',
    descriptionEn: 'The actual representative contract for the ranked-member report.',
  },
  ...[
    ['contract_open_interest', '代表合约总持仓量。', 'Representative-contract open interest.'],
    ['contract_volume', '代表合约成交量。', 'Representative-contract volume.'],
    ['ranked_volume', '排名会员成交量合计。', 'Aggregate volume of ranked members.'],
    ['ranked_volume_change', '排名会员成交量变化。', 'Change in ranked-member volume.'],
    ['ranked_long_holding', '排名会员多头持仓合计。', 'Aggregate ranked-member long holdings.'],
    ['ranked_long_change', '排名会员多头持仓变化。', 'Change in ranked-member long holdings.'],
    ['ranked_short_holding', '排名会员空头持仓合计。', 'Aggregate ranked-member short holdings.'],
    ['ranked_short_change', '排名会员空头持仓变化。', 'Change in ranked-member short holdings.'],
    ['top_five_long_holding', '前五名会员多头持仓合计。', 'Top-five member long holdings.'],
    ['top_five_short_holding', '前五名会员空头持仓合计。', 'Top-five member short holdings.'],
    ['volume_member_count', '成交量排名会员数。', 'Number of ranked volume members.'],
    ['long_member_count', '多头排名会员数。', 'Number of ranked long members.'],
    ['short_member_count', '空头排名会员数。', 'Number of ranked short members.'],
  ].map(([name, descriptionZh, descriptionEn]) => ({
    name,
    wireType: name.endsWith('_change') ? ('nullable_number' as const) : ('number' as const),
    pythonType: 'float64',
    descriptionZh,
    descriptionEn,
  })),
  {
    name: 'source_correction_applied',
    wireType: 'boolean',
    pythonType: 'bool',
    descriptionZh: '是否应用过审计确认的来源修正。',
    descriptionEn: 'Whether an audited source correction was applied.',
  },
] satisfies readonly ResearchSdkDataFrameColumnContractV1[];

function commodityDatasetFunction(
  name: 'commodity_returns' | 'commodity_warehouse_receipts' | 'commodity_holdings',
  descriptionZh: string,
  descriptionEn: string,
  productValues: readonly string[],
  columns: readonly ResearchSdkDataFrameColumnContractV1[],
): ResearchSdkFunctionContractV1 {
  return {
    qualifiedName: `data.${name}`,
    namespace: 'data',
    name,
    descriptionZh,
    descriptionEn,
    examples: [`data.${name}("${productValues[0]}", start="20200101", end="20251231")`],
    notesZh: [
      'date 是研究可得日，trade_date 是来源交易日；查询严格按 date 防止未来数据泄漏。',
      '该数据只用于研究，不表示平台支持相应商品的交易执行。',
    ],
    notesEn: [
      'date is the research availability date and trade_date is the source-market date; queries are gated by date to prevent look-ahead.',
      'These data are research-only and do not imply trading support for the commodity.',
    ],
    parameters: [
      {
        name: 'product',
        type: 'enum',
        required: true,
        keywordOnly: false,
        values: productValues,
        descriptionZh: '平台审核过的商品品种代码。',
        descriptionEn: 'A governed commodity product code.',
      },
      {
        name: 'start',
        type: 'date',
        required: true,
        keywordOnly: true,
        descriptionZh: '研究可得日起始日期，格式 YYYYMMDD。',
        descriptionEn: 'Inclusive research-availability start date in YYYYMMDD format.',
      },
      {
        name: 'end',
        type: 'date',
        required: true,
        keywordOnly: true,
        descriptionZh: '研究可得日结束日期，格式 YYYYMMDD。',
        descriptionEn: 'Inclusive research-availability end date in YYYYMMDD format.',
      },
    ],
    returns: { kind: 'dataframe', columns },
  };
}

const marketStateColumns = [
  {
    name: 'date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '市场交易日。',
    descriptionEn: 'The market trading date.',
  },
  ...[
    ['activity', '20 日流通市值加权换手率均值。', '20-day average float-weighted turnover rate.'],
    [
      'breadth',
      '站上 20 日和 60 日均线比例的均值。',
      'Mean share above the 20-day and 60-day moving averages.',
    ],
    ['trend', '20 日市场或指数收益率。', '20-day market or index return.'],
    [
      'crowding',
      '成交额最高 5% 股票的成交额占比。',
      'Amount share of the top 5% most-traded stocks.',
    ],
    ['advance_ratio', '上涨股票占比。', 'Share of advancing stocks.'],
    [
      'above_ma20_ratio',
      '站上 20 日均线的股票占比。',
      'Share of stocks above the 20-day moving average.',
    ],
    [
      'above_ma60_ratio',
      '站上 60 日均线的股票占比。',
      'Share of stocks above the 60-day moving average.',
    ],
    ['total_amount_cny_1k', '总成交额，千元人民币。', 'Total trading amount in CNY 1,000.'],
    ['extreme_move_ratio', '极端涨跌股票占比。', 'Share of stocks with extreme price moves.'],
    ['limit_up_count', '涨停股票数量。', 'Number of limit-up stocks.'],
    ['limit_down_count', '跌停股票数量。', 'Number of limit-down stocks.'],
    ['traded_count', '纳入计算的交易股票数量。', 'Number of traded stocks included.'],
  ].map(([name, descriptionZh, descriptionEn]) => ({
    name,
    wireType: name.endsWith('_count') ? ('number' as const) : ('nullable_number' as const),
    pythonType: 'float64',
    descriptionZh,
    descriptionEn,
  })),
] satisfies readonly ResearchSdkDataFrameColumnContractV1[];

const equityFundamentalColumns = [
  {
    name: 'date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '财务指标公告日，即研究可得日。',
    descriptionEn: 'The financial-indicator announcement date and research availability date.',
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
    name: 'industry',
    wireType: 'nullable_string',
    pythonType: 'str | None',
    descriptionZh: '估值日申万一级行业。',
    descriptionEn: 'Point-in-time SW level-1 industry on the as-of date.',
  },
  {
    name: 'applicability',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: 'industrial、unsupported_financial 或 unknown。',
    descriptionEn: 'industrial, unsupported_financial, or unknown.',
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
    descriptionZh: 'M2 类型化财报科目名。',
    descriptionEn: 'The typed M2 statement field name.',
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
    name: 'industry',
    wireType: 'nullable_string',
    pythonType: 'str | None',
    descriptionZh: '截面日申万一级行业。',
    descriptionEn: 'Point-in-time SW level-1 industry.',
  },
  {
    name: 'applicability',
    wireType: 'string',
    pythonType: 'str',
    descriptionZh: 'industrial、unsupported_financial 或 unknown。',
    descriptionEn: 'industrial, unsupported_financial, or unknown.',
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

const equityFlowColumns = [
  {
    name: 'date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '精确交易日；数据不会向前填充。',
    descriptionEn: 'The exact trading date; values are never carried forward.',
  },
  ...[
    ['net_main_cny_10k', '主力净流入，万元人民币。', 'Main-force net inflow in CNY 10,000.'],
    ['net_total_cny_10k', '全口径净流入，万元人民币。', 'All-order-size net inflow in CNY 10,000.'],
    ['dragon_tiger_net_cny', '龙虎榜当日净买入，元人民币。', 'Dragon-Tiger List net buy in CNY.'],
  ].map(([name, descriptionZh, descriptionEn]) => ({
    name,
    wireType: 'nullable_number' as const,
    pythonType: 'float64',
    descriptionZh,
    descriptionEn,
  })),
] satisfies readonly ResearchSdkDataFrameColumnContractV1[];

const equityDividendColumns = [
  {
    name: 'date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '实施分红的除权除息日。',
    descriptionEn: 'The ex-dividend date of the implemented distribution.',
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

const factorWeatherColumns = [
  {
    name: 'formation_date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '形成因子分组的月末日期。',
    descriptionEn: 'The month-end date on which factor groups were formed.',
  },
  {
    name: 'period_end_date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '实现收益的月末日期。',
    descriptionEn: 'The month-end date on which returns were realized.',
  },
  ...[
    ['rank_ic', '当月 Rank IC。', 'Monthly rank IC.'],
    ['top_return', '头部组毛收益率。', 'Top-group gross return.'],
    ['bottom_return', '尾部组毛收益率。', 'Bottom-group gross return.'],
    ['long_short_gross_return', '多空组合毛收益率。', 'Long-short gross return.'],
    [
      'long_short_net_return',
      '计入换手成本后的多空组合净收益率。',
      'Long-short net return after turnover cost.',
    ],
    ['top_turnover', '头部组换手率。', 'Top-group turnover.'],
    ['sample_size', '样本股票数量。', 'Number of stocks in the sample.'],
    ['sample_coverage', '有效样本覆盖率。', 'Valid-sample coverage ratio.'],
  ].map(([name, descriptionZh, descriptionEn]) => ({
    name,
    wireType: name === 'top_turnover' ? ('nullable_number' as const) : ('number' as const),
    pythonType: 'float64',
    descriptionZh,
    descriptionEn,
  })),
] satisfies readonly ResearchSdkDataFrameColumnContractV1[];

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

const industryStateColumns = [
  {
    name: 'date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '申万一级行业状态交易日。',
    descriptionEn: 'Shenwan level-1 industry state trading date.',
  },
  {
    name: 'industry_code',
    wireType: 'string',
    pythonType: 'string',
    descriptionZh: '申万一级行业代码。',
    descriptionEn: 'Shenwan level-1 industry code.',
  },
  {
    name: 'industry_name',
    wireType: 'string',
    pythonType: 'string',
    descriptionZh: '申万一级行业名称。',
    descriptionEn: 'Shenwan level-1 industry name.',
  },
  {
    name: 'traded_count',
    wireType: 'number',
    pythonType: 'int64',
    descriptionZh: '纳入统计的股票数。',
    descriptionEn: 'Number of stocks included in the observation.',
  },
  ...[
    ['return_20d', '行业 20 日收益率。', 'Industry 20-day return.'],
    [
      'excess_return_20d',
      '相对全市场等权口径的 20 日超额收益。',
      '20-day excess return versus the equal-weight market.',
    ],
    [
      'positive_return_20d_ratio',
      '20 日收益为正的股票占比。',
      'Share of stocks with a positive 20-day return.',
    ],
    [
      'above_ma20_ratio',
      '收盘价高于 20 日均线的股票占比。',
      'Share of stocks above their 20-day moving average.',
    ],
    [
      'above_ma60_ratio',
      '收盘价高于 60 日均线的股票占比。',
      'Share of stocks above their 60-day moving average.',
    ],
    [
      'float_weighted_turnover_rate_pct',
      '流通市值加权换手率，百分比。',
      'Float-market-cap weighted turnover rate in percentage points.',
    ],
    ['amount_share', '行业成交额占全市场比例。', 'Industry share of whole-market trading amount.'],
    [
      'top_five_amount_share',
      '行业内成交额前 5% 股票的成交额占比。',
      'Trading-amount share of the top 5% most active stocks in the industry.',
    ],
  ].map(([name, descriptionZh, descriptionEn]) => ({
    name,
    wireType: 'nullable_number' as const,
    pythonType: 'float64',
    descriptionZh,
    descriptionEn,
  })),
] satisfies readonly ResearchSdkDataFrameColumnContractV1[];

const futuresSettlementColumns = [
  {
    name: 'date',
    wireType: 'trade_date',
    pythonType: 'datetime64[ns]',
    descriptionZh: '结算参数交易日。',
    descriptionEn: 'Settlement-parameter trading date.',
  },
  ...[
    ['settle', '交易所结算价。', 'Exchange settlement price.'],
    ['trading_fee_rate', '交易手续费率。', 'Trading fee rate.'],
    ['trading_fee', '每手交易手续费。', 'Trading fee per contract.'],
    ['delivery_fee', '每手交割手续费。', 'Delivery fee per contract.'],
    [
      'buy_hedge_margin_rate_pct',
      '买套保保证金率，来源百分比点。',
      'Buy-hedge margin rate in provider percentage points.',
    ],
    [
      'sell_hedge_margin_rate_pct',
      '卖套保保证金率，来源百分比点。',
      'Sell-hedge margin rate in provider percentage points.',
    ],
    [
      'long_margin_rate_pct',
      '多头保证金率，来源百分比点。',
      'Long margin rate in provider percentage points.',
    ],
    [
      'short_margin_rate_pct',
      '空头保证金率，来源百分比点。',
      'Short margin rate in provider percentage points.',
    ],
    ['close_today_fee', '每手平今手续费。', 'Same-day close fee per contract.'],
  ].map(([name, descriptionZh, descriptionEn]) => ({
    name,
    wireType: 'nullable_number' as const,
    pythonType: 'float64',
    descriptionZh,
    descriptionEn,
  })),
  {
    name: 'exchange',
    wireType: 'nullable_string',
    pythonType: 'string',
    descriptionZh: '交易所代码。',
    descriptionEn: 'Exchange code.',
  },
] satisfies readonly ResearchSdkDataFrameColumnContractV1[];

function datedIdentifierDatasetFunction(
  name: 'equity_fundamentals' | 'equity_flows' | 'equity_dividends',
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

function referenceDatasetFunction(
  name: 'etf_shares' | 'index_valuation' | 'industry_state' | 'futures_settlement',
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
          type: 'string',
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
      qualifiedName: 'data.yield_curve',
      namespace: 'data',
      name: 'yield_curve',
      descriptionZh: '读取平台审核过的主权收益率曲线期限序列，返回固定列的 pandas DataFrame。',
      descriptionEn:
        'Load one governed sovereign-yield curve tenor as a fixed-schema pandas DataFrame.',
      examples: [
        'data.yield_curve("us_treasury_real", tenor="10Y", start="20150101", end="20251231", transform="difference")',
      ],
      notesZh: [
        'curve 与 tenor 的组合必须来自研究目录；名义收益率和实际收益率不能互换。',
        'value 的水平单位是百分比；difference 表示百分点变化，而不是债券收益率。',
        '美国收盘数据用于中国市场研究时，研究代码必须显式滞后或说明时区口径。',
      ],
      notesEn: [
        'Resolve the curve and tenor pair through the research catalog; nominal and real yields are not interchangeable.',
        'Level values are percentages; difference means percentage-point change, not a bond return.',
        'China-market research must explicitly lag US-close observations or disclose its time-zone convention.',
      ],
      parameters: [
        {
          name: 'curve',
          type: 'enum',
          required: true,
          keywordOnly: false,
          values: RESEARCH_YIELD_CURVE_CODES_V1,
          descriptionZh: '平台审核过的收益率曲线代码。',
          descriptionEn: 'A governed yield-curve code.',
        },
        {
          name: 'tenor',
          type: 'enum',
          required: true,
          keywordOnly: true,
          values: RESEARCH_YIELD_TENORS_V1,
          descriptionZh: '曲线期限，例如 10Y。',
          descriptionEn: 'The curve tenor, for example 10Y.',
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
          values: RESEARCH_YIELD_TRANSFORMS_V1,
          descriptionZh: '输出收益率水平或百分点变化。',
          descriptionEn: 'Return yield levels or percentage-point differences.',
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
            descriptionZh: '观测可得日；进入 Python 后转换为 pandas datetime。',
            descriptionEn: 'Observation availability date, converted to pandas datetime in Python.',
          },
          {
            name: 'value',
            wireType: 'number',
            pythonType: 'float64',
            descriptionZh: '收益率百分比水平或所选变换后的值。',
            descriptionEn: 'The yield percentage level or selected transformed value.',
          },
        ],
      },
    },
    {
      qualifiedName: 'data.macro',
      namespace: 'data',
      name: 'macro',
      descriptionZh: '读取按发布日期、可得日和版本治理的宏观或货币市场序列。',
      descriptionEn:
        'Load a macroeconomic or money-market series governed by release, availability, and vintage dates.',
      examples: ['data.macro("cn_cpi_yoy", start="20150101", end="20251231", transform="level")'],
      notesZh: [
        'series 必须来自公开宏观目录；返回 date 是研究时真正可用的日期，不是统计期标签。',
        '历史 latest-value 回填会通过 DataFrame attrs 中的诊断披露，不能描述为历史实时版本。',
      ],
      notesEn: [
        'Resolve series through the public macro catalog; date is the research availability date, not the observation-period label.',
        'Historical latest-value backfills are disclosed through DataFrame diagnostics and are not real-time historical vintages.',
      ],
      parameters: [
        {
          name: 'series',
          type: 'enum',
          required: true,
          keywordOnly: false,
          values: RESEARCH_MACRO_SERIES_KEYS_V1,
          descriptionZh: '平台审核过的宏观序列标识。',
          descriptionEn: 'A governed macro series identifier.',
        },
        {
          name: 'start',
          type: 'date',
          required: true,
          keywordOnly: true,
          descriptionZh: '研究可得日的起始日期，格式为 YYYYMMDD。',
          descriptionEn: 'Inclusive research-availability start date in YYYYMMDD format.',
        },
        {
          name: 'end',
          type: 'date',
          required: true,
          keywordOnly: true,
          descriptionZh: '研究可得日的结束日期，格式为 YYYYMMDD。',
          descriptionEn: 'Inclusive research-availability end date in YYYYMMDD format.',
        },
        {
          name: 'frequency',
          type: 'enum',
          required: false,
          keywordOnly: true,
          defaultValue: 'daily',
          values: RESEARCH_SERIES_FREQUENCIES_V1,
          descriptionZh: '输出频率；daily 保留真实可得日。',
          descriptionEn: 'Output frequency; daily preserves the actual availability date.',
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
            descriptionZh: '该观测进入研究的可得日期。',
            descriptionEn: 'The date on which the observation became available to research.',
          },
          {
            name: 'value',
            wireType: 'number',
            pythonType: 'float64',
            descriptionZh: '按序列声明单位表示的值或所选变换结果。',
            descriptionEn: 'The value in the series-declared unit or selected transformed value.',
          },
        ],
      },
    },
    {
      qualifiedName: 'data.fx',
      namespace: 'data',
      name: 'fx',
      descriptionZh: '读取按跨市场可得日治理的外汇中间收盘价序列。',
      descriptionEn: 'Load an FX mid-close series governed by cross-market availability dates.',
      examples: [
        'data.fx("USDCNH.FXCM", start="20150101", end="20251231", transform="simple_return")',
      ],
      notesZh: [
        '直接序列取 bid/ask 收盘均值；HKDCNH.DERIVED 按同一可得日 USDCNH ÷ USDHKD 推导。',
        'date 是中国收盘研究可安全使用该外汇数据的首个日期。',
      ],
      notesEn: [
        'Direct series use the bid/ask close midpoint; HKDCNH.DERIVED divides USDCNH by USDHKD on the same availability date.',
        'date is the first date on which the FX observation is safe for China-close research.',
      ],
      parameters: [
        {
          name: 'pair',
          type: 'enum',
          required: true,
          keywordOnly: false,
          values: RESEARCH_FX_SERIES_IDS_V1,
          descriptionZh: '平台审核过的外汇序列标识。',
          descriptionEn: 'A governed FX series identifier.',
        },
        {
          name: 'start',
          type: 'date',
          required: true,
          keywordOnly: true,
          descriptionZh: '起始可得日，格式为 YYYYMMDD。',
          descriptionEn: 'Inclusive availability start date in YYYYMMDD format.',
        },
        {
          name: 'end',
          type: 'date',
          required: true,
          keywordOnly: true,
          descriptionZh: '结束可得日，格式为 YYYYMMDD。',
          descriptionEn: 'Inclusive availability end date in YYYYMMDD format.',
        },
        {
          name: 'frequency',
          type: 'enum',
          required: false,
          keywordOnly: true,
          defaultValue: 'daily',
          values: RESEARCH_SERIES_FREQUENCIES_V1,
          descriptionZh: '输出频率。',
          descriptionEn: 'Output frequency.',
        },
        {
          name: 'transform',
          type: 'enum',
          required: false,
          keywordOnly: true,
          defaultValue: 'level',
          values: RESEARCH_SERIES_TRANSFORMS_V1,
          descriptionZh: '应用于汇率序列的确定性变换。',
          descriptionEn: 'The deterministic transform applied to the FX series.',
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
            descriptionZh: '该外汇观测进入中国收盘研究的可得日期。',
            descriptionEn:
              'The date on which the FX observation became available to China-close research.',
          },
          {
            name: 'value',
            wireType: 'number',
            pythonType: 'float64',
            descriptionZh: '每单位基础货币对应的报价货币中间收盘价或所选变换结果。',
            descriptionEn:
              'Quote currency per base currency at the mid close, or the selected transformed value.',
          },
        ],
      },
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
        '返回顶层字段包括 report_id、factor、analysis_kind、phase、research_spec、research_intent、lineage 与 report。',
        'report 与 research_spec 的字段使用 snake_case；原报告快照不会被修改或重新运行。',
        '未揭示的 holdout 报告保持封存，其他用户的报告不可见。',
      ],
      notesEn: [
        'Top-level keys include report_id, factor, analysis_kind, phase, research_spec, research_intent, lineage, and report.',
        'The report and research_spec fields use snake_case; the frozen report is neither mutated nor rerun.',
        'Unrevealed holdout reports remain sealed, and reports owned by other users are not visible.',
      ],
      parameters: [
        {
          name: 'report_id',
          type: 'string',
          required: true,
          keywordOnly: false,
          maximumLength: 512,
          descriptionZh: 'Factor 页面报告历史或报告链接中的稳定报告 ID。',
          descriptionEn: 'The stable report ID from Factor history or a Factor report link.',
        },
      ],
      returns: { kind: 'mapping', pythonType: 'Mapping[str, Any]' },
    },
    {
      qualifiedName: 'results.backtest_report',
      namespace: 'results',
      name: 'backtest_report',
      descriptionZh: '按报告 ID 读取当前用户已完成的不可变 BacktestReport 结果。',
      descriptionEn:
        'Load one completed, immutable BacktestReport result owned by the current user.',
      examples: [
        'report = results.backtest_report("01K5EXAMPLEBACKTESTREPORT")',
        'sharpe = report["report"]["sharpe"]',
      ],
      notesZh: [
        '返回顶层字段包括 report_id、strategy_id、strategy_name、backtest_spec、lineage 与 report。',
        'report 与 backtest_spec 的字段使用 snake_case；原报告快照不会被修改或重新运行。',
        '只允许读取当前用户已完成且带结果的报告。',
      ],
      notesEn: [
        'Top-level keys include report_id, strategy_id, strategy_name, backtest_spec, lineage, and report.',
        'The report and backtest_spec fields use snake_case; the frozen report is neither mutated nor rerun.',
        'Only completed reports with results owned by the current user can be loaded.',
      ],
      parameters: [
        {
          name: 'report_id',
          type: 'string',
          required: true,
          keywordOnly: false,
          maximumLength: 512,
          descriptionZh: 'Research 数据目录中的稳定 BacktestReport ID。',
          descriptionEn: 'The stable BacktestReport ID from the Research data catalog.',
        },
      ],
      returns: { kind: 'mapping', pythonType: 'Mapping[str, Any]' },
    },
    commodityDatasetFunction(
      'commodity_returns',
      '读取审计过的商品主力合约连续收益与换月分解。',
      'Load audited commodity main-contract continuous returns and roll decomposition.',
      RESEARCH_COMMODITY_PRODUCT_CODES_V1,
      RESEARCH_COMMODITY_RETURN_COLUMNS_V1,
    ),
    commodityDatasetFunction(
      'commodity_warehouse_receipts',
      '读取交易所商品仓单总量与变化。',
      'Load exchange commodity warehouse-receipt totals and changes.',
      RESEARCH_COMMODITY_PRODUCT_CODES_V1,
      RESEARCH_COMMODITY_WAREHOUSE_RECEIPT_COLUMNS_V1,
    ),
    commodityDatasetFunction(
      'commodity_holdings',
      '读取实际代表合约的排名会员持仓聚合。',
      'Load ranked-member holding aggregates for the actual representative contract.',
      RESEARCH_COMMODITY_HOLDING_PRODUCT_CODES_V1,
      RESEARCH_COMMODITY_HOLDING_COLUMNS_V1,
    ),
    {
      qualifiedName: 'data.market_state',
      namespace: 'data',
      name: 'market_state',
      descriptionZh: '读取全市场或 PIT 指数成分范围的描述性市场状态时间序列。',
      descriptionEn:
        'Load descriptive market-state time series for the whole market or a point-in-time index universe.',
      examples: [
        'data.market_state("all", start="20200101", end="20251231")',
        'data.market_state("000300.SH", start="20200101", end="20251231")',
      ],
      notesZh: [
        '指标是描述性测量而非预测；指数范围使用当日可得的最近成分股快照。',
        'date 是同一中国市场交易日；activity 需要 20 个观测的预热期。',
      ],
      notesEn: [
        'Metrics are descriptive rather than forecasts; index scopes use the latest constituent snapshot available on each date.',
        'date is the same China-market trading date; activity requires a 20-observation warm-up.',
      ],
      parameters: [
        {
          name: 'scope',
          type: 'enum',
          required: true,
          keywordOnly: false,
          values: RESEARCH_MARKET_STATE_SCOPES_V1,
          descriptionZh: 'all 或平台支持的指数代码。',
          descriptionEn: 'all or a supported index code.',
        },
        {
          name: 'start',
          type: 'date',
          required: true,
          keywordOnly: true,
          descriptionZh: '起始交易日，格式 YYYYMMDD。',
          descriptionEn: 'Inclusive trading-date start in YYYYMMDD format.',
        },
        {
          name: 'end',
          type: 'date',
          required: true,
          keywordOnly: true,
          descriptionZh: '结束交易日，格式 YYYYMMDD。',
          descriptionEn: 'Inclusive trading-date end in YYYYMMDD format.',
        },
      ],
      returns: { kind: 'dataframe', columns: marketStateColumns },
    },
    datedIdentifierDatasetFunction(
      'equity_fundamentals',
      '按公告日读取单只股票的财务指标历史。',
      'Load one stock financial-indicator history by announcement date.',
      equityFundamentalColumns,
    ),
    datedIdentifierDatasetFunction(
      'equity_flows',
      '读取单只股票的精确日资金流与龙虎榜净买入。',
      'Load exact-date money flow and Dragon-Tiger List net buying for one stock.',
      equityFlowColumns,
    ),
    datedIdentifierDatasetFunction(
      'equity_dividends',
      '按除权除息日读取单只股票已实施的现金分红。',
      'Load implemented cash dividends for one stock by ex-dividend date.',
      equityDividendColumns,
    ),
    {
      qualifiedName: 'results.strategy_scan_report',
      namespace: 'results',
      name: 'strategy_scan_report',
      descriptionZh: '按报告 ID 读取当前用户已完成的不可变策略参数扫描结果。',
      descriptionEn:
        'Load one completed immutable strategy parameter-scan result owned by the current user.',
      examples: ['scan = results.strategy_scan_report("01K5EXAMPLESCANREPORT")'],
      notesZh: ['返回冻结的 config、spec、逐参数组合指标和数据截止日；不会重新运行扫描。'],
      notesEn: [
        'Returns the frozen config, spec, per-combination metrics, and data cutoff without rerunning the scan.',
      ],
      parameters: [
        {
          name: 'report_id',
          type: 'string',
          required: true,
          keywordOnly: false,
          maximumLength: 512,
          descriptionZh: '策略参数扫描历史中的稳定报告 ID。',
          descriptionEn: 'The stable report ID from strategy parameter-scan history.',
        },
      ],
      returns: { kind: 'mapping', pythonType: 'Mapping[str, Any]' },
    },
    {
      qualifiedName: 'results.factor_weather',
      namespace: 'results',
      name: 'factor_weather',
      descriptionZh: '按因子 ID 读取当前用户已固定因子的月度气象观测。',
      descriptionEn: 'Load monthly weather observations for a factor pinned by the current user.',
      examples: ['weather = results.factor_weather("momentum-factor-id")'],
      notesZh: [
        '仅返回已计算并落库的观测，不触发刷新；方法论和因子代码哈希保存在 DataFrame attrs["jixie"]。',
      ],
      notesEn: [
        'Returns only stored observations without triggering a refresh; methodology and factor code hash are in DataFrame attrs["jixie"].',
      ],
      parameters: [
        {
          name: 'factor_id',
          type: 'string',
          required: true,
          keywordOnly: false,
          maximumLength: 512,
          descriptionZh: '因子气象中已固定的因子 ID。',
          descriptionEn: 'The factor ID pinned in Factor Weather.',
        },
      ],
      returns: { kind: 'dataframe', columns: factorWeatherColumns },
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
    referenceDatasetFunction(
      'industry_state',
      '读取申万一级行业的趋势、广度与交易活跃度。',
      'Load trend, breadth, and trading activity for a Shenwan level-1 industry.',
      '801120.SI',
      '使用申万一级行业代码或名称',
      'uses a Shenwan level-1 industry code or name',
      '交易日',
      'trading date',
      industryStateColumns,
    ),
    referenceDatasetFunction(
      'futures_settlement',
      '读取实际交割合约的历史结算价、手续费与交易所保证金参数。',
      'Load historical settlement prices, fees, and exchange margin parameters for an actual futures contract.',
      'IF2609.CFX',
      '使用实际交割合约代码，不接受连续合约',
      'uses an actual delivery-contract code; continuous symbols are not accepted',
      '交易日',
      'trading date',
      futuresSettlementColumns,
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
        'V1 工业企业口径不适用于银行和非银金融，遇到金融行业会明确拒绝。',
      ],
      notesEn: [
        'Returns a report_period-by-statement_kind-by-field long frame; strict PIT excludes reconstructed versions.',
        'The V1 industrial-company model explicitly rejects banks and non-bank financial companies.',
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
        '股票池、行业、市场数据和财报均按截面日 PIT 解析；返回 date × code × metric 长表。',
        '最多选择八个指标且最多返回 50000 行；金融企业保留为 not_applicable 行。',
      ],
      notesEn: [
        'Universe, industry, market data, and statements all resolve point-in-time on the cross-section date; returns a date-by-code-by-metric long frame.',
        'At most eight metrics and 50,000 rows are allowed; financial companies remain as not_applicable rows.',
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
  ],
} as const satisfies ResearchSdkContractV1;

export const RESEARCH_SERIES_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[0];
export const RESEARCH_CROSS_SECTION_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[1];
export const RESEARCH_PANEL_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[2];
export const RESEARCH_YIELD_CURVE_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[3];
export const RESEARCH_MACRO_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[4];
export const RESEARCH_FX_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[5];
export const RESEARCH_FACTOR_REPORT_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[6];
export const RESEARCH_BACKTEST_REPORT_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[7];
export const RESEARCH_COMMODITY_RETURNS_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[8];
export const RESEARCH_COMMODITY_WAREHOUSE_RECEIPTS_SDK_CONTRACT_V1 =
  RESEARCH_SDK_CONTRACT_V1.functions[9];
export const RESEARCH_COMMODITY_HOLDINGS_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[10];
export const RESEARCH_MARKET_STATE_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[11];
export const RESEARCH_EQUITY_FUNDAMENTALS_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[12];
export const RESEARCH_EQUITY_FLOWS_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[13];
export const RESEARCH_EQUITY_DIVIDENDS_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[14];
export const RESEARCH_STRATEGY_SCAN_REPORT_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[15];
export const RESEARCH_FACTOR_WEATHER_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[16];
export const RESEARCH_ETF_SHARES_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[17];
export const RESEARCH_INDEX_VALUATION_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[18];
export const RESEARCH_INDUSTRY_STATE_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[19];
export const RESEARCH_FUTURES_SETTLEMENT_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[20];
export const RESEARCH_FINANCIAL_STATEMENTS_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[21];
export const RESEARCH_FINANCIAL_METRICS_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[22];
export const RESEARCH_FINANCIAL_CROSS_SECTION_SDK_CONTRACT_V1 =
  RESEARCH_SDK_CONTRACT_V1.functions[23];
export const RESEARCH_FINANCIAL_PANEL_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[24];
