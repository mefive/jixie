export const RESEARCH_SERIES_ASSET_TYPES_V1 = ['stock', 'etf', 'index', 'future'] as const;
export const RESEARCH_SERIES_FREQUENCIES_V1 = ['daily', 'monthly'] as const;
export const RESEARCH_SERIES_TRANSFORMS_V1 = [
  'level',
  'difference',
  'simple_return',
  'percent_change',
  'year_over_year',
] as const;
export const RESEARCH_YIELD_CURVE_CODES_V1 = ['us_treasury_nominal', 'us_treasury_real'] as const;
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
export const RESEARCH_FACTOR_REPORT_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[4];
export const RESEARCH_BACKTEST_REPORT_SDK_CONTRACT_V1 = RESEARCH_SDK_CONTRACT_V1.functions[5];
