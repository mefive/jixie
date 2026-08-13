import type {
  ResearchCapabilityCatalogV1,
  ResearchMeasureDefinitionV1,
  ResearchProtocolDefinitionV1,
  ResearchUniverseMeasureDefinitionV1,
} from '@jixie/shared';

export const researchUniverseMeasures = [
  {
    id: 'equity.close',
    version: 1,
    nameZh: '收盘价',
    nameEn: 'Close',
    unit: 'CNY',
    descriptionZh: '所选交易日的未复权收盘价。',
    descriptionEn: 'Unadjusted close on the selected trading date.',
    pointInTime: true,
  },
  {
    id: 'equity.daily_return_pct',
    version: 1,
    nameZh: '当日涨跌幅',
    nameEn: 'Daily return',
    unit: 'percent',
    descriptionZh: '所选交易日相对前收盘价的涨跌幅。',
    descriptionEn: 'Percentage change from the previous close on the selected date.',
    pointInTime: true,
  },
  {
    id: 'equity.pe',
    version: 1,
    nameZh: '市盈率',
    nameEn: 'P/E',
    unit: 'ratio',
    descriptionZh: '所选交易日的静态市盈率。',
    descriptionEn: 'Static price-to-earnings ratio on the selected date.',
    pointInTime: true,
  },
  {
    id: 'equity.pe_ttm',
    version: 1,
    nameZh: '市盈率 TTM',
    nameEn: 'P/E TTM',
    unit: 'ratio',
    descriptionZh: '所选交易日按滚动十二个月利润计算的市盈率。',
    descriptionEn: 'Trailing-twelve-month P/E on the selected date.',
    pointInTime: true,
  },
  {
    id: 'equity.pb',
    version: 1,
    nameZh: '市净率',
    nameEn: 'P/B',
    unit: 'ratio',
    descriptionZh: '所选交易日的市净率。',
    descriptionEn: 'Price-to-book ratio on the selected date.',
    pointInTime: true,
  },
  {
    id: 'equity.ps',
    version: 1,
    nameZh: '市销率',
    nameEn: 'P/S',
    unit: 'ratio',
    descriptionZh: '所选交易日的市销率。',
    descriptionEn: 'Price-to-sales ratio on the selected date.',
    pointInTime: true,
  },
  {
    id: 'equity.dividend_yield_pct',
    version: 1,
    nameZh: '股息率',
    nameEn: 'Dividend yield',
    unit: 'percent',
    descriptionZh: '所选交易日的数据供应商股息率口径。',
    descriptionEn: 'Provider-defined dividend yield on the selected date.',
    pointInTime: true,
  },
  {
    id: 'equity.total_market_cap_cny_10k',
    version: 1,
    nameZh: '总市值',
    nameEn: 'Total market cap',
    unit: 'CNY_10k',
    descriptionZh: '所选交易日的总市值，单位万元。',
    descriptionEn: 'Total market capitalization in CNY 10,000 on the selected date.',
    pointInTime: true,
  },
  {
    id: 'equity.float_market_cap_cny_10k',
    version: 1,
    nameZh: '流通市值',
    nameEn: 'Float market cap',
    unit: 'CNY_10k',
    descriptionZh: '所选交易日的流通市值，单位万元。',
    descriptionEn: 'Float market capitalization in CNY 10,000 on the selected date.',
    pointInTime: true,
  },
  {
    id: 'equity.turnover_rate_pct',
    version: 1,
    nameZh: '换手率',
    nameEn: 'Turnover rate',
    unit: 'percent',
    descriptionZh: '所选交易日按流通股本计算的换手率。',
    descriptionEn: 'Turnover rate based on float shares on the selected date.',
    pointInTime: true,
  },
] satisfies ResearchUniverseMeasureDefinitionV1[];

const measures = [
  {
    id: 'market.adjusted_close',
    nameZh: '复权收盘价',
    nameEn: 'Adjusted close',
    descriptionZh: '使用累计复权因子统一公司行动后的可比收盘价。指数和期货无需复权。',
    descriptionEn:
      'Comparable close adjusted for corporate actions. Indexes and futures require no adjustment.',
    unit: 'quote_currency',
    sourceKinds: ['instrument'],
    assetTypes: ['stock', 'etf', 'index', 'future'],
    transforms: ['level', 'difference', 'simple_return', 'percent_change'],
    pointInTime: true,
    version: 1,
  },
  {
    id: 'macro.observation',
    nameZh: '宏观观测值',
    nameEn: 'Macroeconomic observation',
    descriptionZh: '按发布日期、可得日期和数据版本读取的宏观序列值。',
    descriptionEn: 'Macroeconomic value selected by release date, availability date, and vintage.',
    unit: 'series_declared',
    sourceKinds: ['macro'],
    transforms: ['level', 'difference', 'percent_change', 'year_over_year'],
    pointInTime: true,
    version: 1,
  },
  {
    id: 'rates.yield_pct',
    nameZh: '收益率',
    nameEn: 'Yield',
    descriptionZh: '按曲线、期限与首个可用交易日读取的百分比收益率。',
    descriptionEn: 'Percentage yield selected by curve, tenor, and first available trading day.',
    unit: 'percent',
    sourceKinds: ['yield_curve'],
    transforms: ['level', 'difference', 'percent_change'],
    pointInTime: true,
    version: 1,
  },
  {
    id: 'fx.mid_close',
    nameZh: '汇率中间收盘价',
    nameEn: 'FX mid close',
    descriptionZh: '由日线 bid/ask 收盘价均值得到，并遵循跨市场可得日期。',
    descriptionEn: 'Mean of daily bid and ask closes with cross-market availability gating.',
    unit: 'quote_per_base',
    sourceKinds: ['fx'],
    transforms: ['level', 'difference', 'simple_return', 'percent_change'],
    pointInTime: true,
    version: 1,
  },
] satisfies ResearchMeasureDefinitionV1[];

const timeSeriesRelationship = {
  id: 'time_series_relationship',
  version: 1,
  nameZh: '时间序列变量关系',
  nameEn: 'Time-series relationship',
  questionKinds: ['time_series_relationship'],
  minimumObservations: 24,
  assumptions: [
    {
      id: 'prespecified_window',
      labelZh: '预先指定样本区间',
      labelEn: 'Prespecified sample window',
      descriptionZh: '研究区间和主要参数应在查看结果前确定，避免只展示有利时期。',
      descriptionEn:
        'The sample window and primary parameters should be set before inspecting results to avoid selecting favorable periods.',
    },
    {
      id: 'aligned_observations',
      labelZh: '可比时点对齐',
      labelEn: 'Comparable timestamp alignment',
      descriptionZh: '两个序列必须按相同频率和可得时点对齐，不能使用未来数据。',
      descriptionEn:
        'Both series must align on the same frequency and availability timeline without future information.',
    },
    {
      id: 'linear_estimand',
      labelZh: '线性关系口径',
      labelEn: 'Linear estimand',
      descriptionZh: '回归斜率描述条件均值的线性关系，不代表因果关系。',
      descriptionEn:
        'The regression slope describes a linear conditional-mean relationship, not causality.',
    },
  ],
  parameters: [
    {
      id: 'frequency',
      type: 'enum',
      labelZh: '对齐频率',
      labelEn: 'Alignment frequency',
      descriptionZh: '使用日频或完整月度观测对齐两个序列。',
      descriptionEn: 'Align both series using daily or complete monthly observations.',
      adjustable: true,
    },
    {
      id: 'predictorLag',
      type: 'integer',
      labelZh: '解释变量滞后',
      labelEn: 'Predictor lag',
      descriptionZh: '正数表示解释变量领先结果变量的对齐期数。',
      descriptionEn: 'A positive value makes the predictor lead the outcome by aligned periods.',
      adjustable: true,
    },
    {
      id: 'rollingWindow',
      type: 'integer',
      labelZh: '滚动窗口',
      labelEn: 'Rolling window',
      descriptionZh: '用于评价方向和效应是否跨时期稳定。',
      descriptionEn: 'Used to assess whether direction and effect remain stable across periods.',
      adjustable: true,
    },
    {
      id: 'neweyWestLag',
      type: 'integer',
      labelZh: 'Newey–West 滞后阶数',
      labelEn: 'Newey–West lag',
      descriptionZh: '控制异方差与序列相关稳健标准误的截断滞后。',
      descriptionEn:
        'Controls the truncation lag for heteroskedasticity and autocorrelation-consistent standard errors.',
      adjustable: true,
    },
  ],
  terminology: [
    {
      id: 'predictor',
      labelZh: '解释变量',
      labelEn: 'Predictor',
      descriptionZh: '用于解释或领先另一个序列的变量，不自动代表可交易预测信号。',
      descriptionEn:
        'The variable used to explain or lead another series; it is not automatically a tradable signal.',
    },
    {
      id: 'outcome',
      labelZh: '结果变量',
      labelEn: 'Outcome',
      descriptionZh: '研究问题试图解释的序列。',
      descriptionEn: 'The series the research question attempts to explain.',
    },
    {
      id: 'hac_inference',
      labelZh: 'HAC 推断',
      labelEn: 'HAC inference',
      descriptionZh: '对异方差与有限阶序列相关稳健的回归标准误和区间。',
      descriptionEn:
        'Regression standard errors and intervals robust to heteroskedasticity and finite-order autocorrelation.',
    },
  ],
  formulae: [
    {
      id: 'pearson_correlation',
      labelZh: 'Pearson 相关系数',
      labelEn: 'Pearson correlation',
      latex: String.raw`r_{xy}=\frac{\sum_{t=1}^{T}(x_t-\bar{x})(y_t-\bar{y})}{\sqrt{\sum_{t=1}^{T}(x_t-\bar{x})^2}\sqrt{\sum_{t=1}^{T}(y_t-\bar{y})^2}}`,
      variables: [
        { symbol: 'x_t', descriptionZh: '第 t 期预测变量', descriptionEn: 'Predictor at t' },
        { symbol: 'y_t', descriptionZh: '第 t 期结果变量', descriptionEn: 'Outcome at t' },
        { symbol: 'T', descriptionZh: '对齐后的观测数', descriptionEn: 'Aligned observations' },
      ],
    },
    {
      id: 'linear_regression',
      labelZh: '线性回归',
      labelEn: 'Linear regression',
      latex: String.raw`y_t=\alpha+\beta x_{t-k}+\varepsilon_t`,
      variables: [
        { symbol: '\\alpha', descriptionZh: '截距', descriptionEn: 'Intercept' },
        { symbol: '\\beta', descriptionZh: '斜率', descriptionEn: 'Slope' },
        { symbol: 'k', descriptionZh: '预测变量滞后期数', descriptionEn: 'Predictor lag' },
      ],
    },
  ],
  pythonExample: `import pandas as pd
import statsmodels.api as sm

aligned = pd.concat([predictor, outcome], axis=1, join="inner").dropna()
x = sm.add_constant(aligned["predictor"])
fit = sm.OLS(aligned["outcome"], x).fit(cov_type="HAC", cov_kwds={"maxlags": hac_lag})
pearson = aligned["predictor"].corr(aligned["outcome"], method="pearson")
spearman = aligned["predictor"].corr(aligned["outcome"], method="spearman")`,
  helpSlugs: {
    zh: ['/docs/help/basics/time-series-relationships'],
    en: ['/docs/help/basics/time-series-relationships'],
  },
} satisfies ResearchProtocolDefinitionV1;

const distributionComparison = {
  id: 'distribution_comparison',
  version: 1,
  nameZh: '两组分布比较',
  nameEn: 'Two-group distribution comparison',
  questionKinds: ['distribution_comparison'],
  minimumObservations: 20,
  assumptions: [
    {
      id: 'point_in_time_groups',
      labelZh: '同一历史时点',
      labelEn: 'Common point in time',
      descriptionZh: '两组对象必须按相同可得时点、资格条件和指标版本解析。',
      descriptionEn:
        'Both groups must resolve with the same availability time, eligibility rules, and measure version.',
    },
    {
      id: 'independent_groups',
      labelZh: '互不重叠的样本组',
      labelEn: 'Disjoint samples',
      descriptionZh: 'Welch 推断要求两组对象互不重叠；系统会拒绝重复成员。',
      descriptionEn:
        'Welch inference requires disjoint entity groups; overlapping members are rejected.',
    },
    {
      id: 'prespecified_measure',
      labelZh: '预先指定比较指标',
      labelEn: 'Prespecified comparison measure',
      descriptionZh: '均值差和方向假设应在查看结果前固定，不能结果出来后更换指标。',
      descriptionEn:
        'The mean difference and direction should be fixed before inspecting results rather than changing the measure afterward.',
    },
  ],
  parameters: [
    {
      id: 'groupA',
      type: 'enum',
      labelZh: 'A 组',
      labelEn: 'Group A',
      descriptionZh: '均值差按 A 组减 B 组定义。',
      descriptionEn: 'The mean difference is defined as group A minus group B.',
      adjustable: false,
    },
    {
      id: 'groupB',
      type: 'enum',
      labelZh: 'B 组',
      labelEn: 'Group B',
      descriptionZh: '作为比较基准的第二组对象。',
      descriptionEn: 'The second entity group used as the comparison reference.',
      adjustable: false,
    },
    {
      id: 'tailFraction',
      type: 'number',
      labelZh: '缩尾比例',
      labelEn: 'Winsorization fraction',
      descriptionZh: '两端分别缩尾的样本比例，用于检查极端值敏感性。',
      descriptionEn:
        'The sample fraction winsorized in each tail for the outlier-sensitivity check.',
      adjustable: true,
    },
  ],
  terminology: [
    {
      id: 'welch_interval',
      labelZh: 'Welch 区间',
      labelEn: 'Welch interval',
      descriptionZh: '不要求两组方差相等的均值差区间与 t 统计量。',
      descriptionEn:
        'A mean-difference interval and t statistic that do not assume equal group variances.',
    },
    {
      id: 'cohens_d',
      labelZh: 'Cohen’s d',
      labelEn: "Cohen's d",
      descriptionZh: '用合并组内标准差标准化后的均值差，用于描述效应量。',
      descriptionEn:
        'The mean difference standardized by pooled within-group variation, used as an effect size.',
    },
    {
      id: 'mann_whitney',
      labelZh: 'Mann–Whitney 检验',
      labelEn: 'Mann–Whitney test',
      descriptionZh: '基于排序的分布位置比较，作为不依赖正态分布的补充。',
      descriptionEn:
        'A rank-based distribution-location comparison used as a non-normality-robust complement.',
    },
  ],
  formulae: [
    {
      id: 'welch_mean_difference',
      labelZh: 'Welch 均值差',
      labelEn: 'Welch mean difference',
      latex: String.raw`\Delta=\bar{x}_A-\bar{x}_B,\quad SE(\Delta)=\sqrt{\frac{s_A^2}{n_A}+\frac{s_B^2}{n_B}}`,
      variables: [
        {
          symbol: '\\Delta',
          descriptionZh: 'A 组减 B 组的均值差',
          descriptionEn: 'Group A minus group B mean difference',
        },
        {
          symbol: 's_g',
          descriptionZh: 'g 组样本标准差',
          descriptionEn: 'Sample standard deviation in group g',
        },
        {
          symbol: 'n_g',
          descriptionZh: 'g 组有效样本数',
          descriptionEn: 'Valid observations in group g',
        },
      ],
    },
    {
      id: 'cohens_d',
      labelZh: '标准化效应量',
      labelEn: 'Standardized effect size',
      latex: String.raw`d=\frac{\bar{x}_A-\bar{x}_B}{\sqrt{\frac{(n_A-1)s_A^2+(n_B-1)s_B^2}{n_A+n_B-2}}}`,
      variables: [
        { symbol: 'd', descriptionZh: 'Cohen’s d 效应量', descriptionEn: "Cohen's d effect size" },
      ],
    },
  ],
  pythonExample: `import numpy as np
from scipy import stats

mean_difference = group_a.mean() - group_b.mean()
welch = stats.ttest_ind(group_a, group_b, equal_var=False)
mann_whitney = stats.mannwhitneyu(group_a, group_b, alternative="two-sided")
lower_a, upper_a = np.quantile(group_a, [tail_fraction, 1 - tail_fraction])
lower_b, upper_b = np.quantile(group_b, [tail_fraction, 1 - tail_fraction])
winsorized_difference = np.clip(group_a, lower_a, upper_a).mean() - np.clip(group_b, lower_b, upper_b).mean()`,
  helpSlugs: {
    zh: ['/docs/help/basics/distribution-comparison'],
    en: ['/docs/help/basics/distribution-comparison'],
  },
} satisfies ResearchProtocolDefinitionV1;

export const researchCapabilityCatalog: ResearchCapabilityCatalogV1 = {
  version: 1,
  measures,
  universeMeasures: researchUniverseMeasures,
  protocols: [timeSeriesRelationship, distributionComparison],
};

export const researchMeasureById: ReadonlyMap<string, ResearchMeasureDefinitionV1> = new Map(
  measures.map((measure) => [measure.id, measure]),
);
export const researchProtocolById: ReadonlyMap<string, ResearchProtocolDefinitionV1> = new Map(
  researchCapabilityCatalog.protocols.map((protocol) => [protocol.id, protocol]),
);
export const researchUniverseMeasureById: ReadonlyMap<string, ResearchUniverseMeasureDefinitionV1> =
  new Map(researchUniverseMeasures.map((measure) => [measure.id, measure]));
