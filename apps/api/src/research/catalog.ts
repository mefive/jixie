import type {
  ResearchCapabilityCatalogV1,
  ResearchMeasureDefinitionV1,
  ResearchProtocolDefinitionV1,
} from '@jixie/shared';

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
  minimumObservations: 24,
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

export const researchCapabilityCatalog: ResearchCapabilityCatalogV1 = {
  version: 1,
  measures,
  protocols: [timeSeriesRelationship],
};

export const researchMeasureById: ReadonlyMap<string, ResearchMeasureDefinitionV1> = new Map(
  measures.map((measure) => [measure.id, measure]),
);
export const researchProtocolById: ReadonlyMap<string, ResearchProtocolDefinitionV1> = new Map(
  researchCapabilityCatalog.protocols.map((protocol) => [protocol.id, protocol]),
);
