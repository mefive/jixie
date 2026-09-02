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
export const RESEARCH_PARTIAL_PERIOD_POLICIES_V1 = ['exclude', 'include'] as const;
export const RESEARCH_EQUITY_UNIVERSE_SUGGESTIONS_V1 = [
  'cn_a',
  'index:000300.SH',
  'index:000905.SH',
  'index:000852.SH',
] as const;
export const RESEARCH_EQUITY_RISK_WARNING_POLICIES_V1 = ['exclude', 'include'] as const;
export const RESEARCH_PANEL_FREQUENCIES_V1 = ['month_end'] as const;

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
  descriptionZh: string;
  descriptionEn: string;
}

export interface ResearchSdkDataFrameColumnContractV1 {
  name: string;
  wireType: 'trade_date' | 'number' | 'nullable_number' | 'string' | 'nullable_string' | 'boolean';
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
