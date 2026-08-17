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
    id: 'market.cny_close',
    nameZh: '人民币计价指数水平',
    nameEn: 'CNY-denominated index level',
    descriptionZh:
      '把登记的跨市场价格指数按同一可得日换算为人民币；简单收益可拆成资产本币收益与汇率收益。',
    descriptionEn:
      'Registered cross-market price index converted to CNY on the same availability date; simple return can be separated into local asset and FX returns.',
    unit: 'CNY_index_level',
    sourceKinds: ['instrument'],
    assetTypes: ['index'],
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
      group: 'core_estimate',
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
      group: 'core_estimate',
      labelZh: '线性回归',
      labelEn: 'Linear regression',
      latex: String.raw`y_t=\alpha+\beta x_{t-k}+\varepsilon_t`,
      variables: [
        { symbol: '\\alpha', descriptionZh: '截距', descriptionEn: 'Intercept' },
        { symbol: '\\beta', descriptionZh: '斜率', descriptionEn: 'Slope' },
        { symbol: 'k', descriptionZh: '预测变量滞后期数', descriptionEn: 'Predictor lag' },
      ],
    },
    {
      id: 'newey_west_covariance',
      group: 'inference',
      labelZh: 'Newey–West HAC 协方差',
      labelEn: 'Newey–West HAC covariance',
      latex: String.raw`\widehat{\operatorname{Var}}_{HAC}(\hat{\theta})=(X'X)^{-1}\hat{S}(X'X)^{-1},\quad \hat{S}=\sum_{t=1}^{T}\hat{u}_t^2z_tz_t'+\sum_{\ell=1}^{L}\left(1-\frac{\ell}{L+1}\right)\sum_{t=\ell+1}^{T}\hat{u}_t\hat{u}_{t-\ell}(z_tz_{t-\ell}'+z_{t-\ell}z_t')`,
      variables: [
        {
          symbol: '\\hat{\\theta}=(\\hat{\\alpha},\\hat{\\beta})',
          descriptionZh: '回归截距与斜率估计',
          descriptionEn: 'Estimated regression intercept and slope',
        },
        {
          symbol: 'z_t=(1,x_{t-k})',
          descriptionZh: '第 t 期包含常数项的回归向量',
          descriptionEn: 'Regression vector including the intercept at t',
        },
        {
          symbol: 'L',
          descriptionZh: 'Newey–West 截断滞后阶数',
          descriptionEn: 'Newey–West truncation lag',
        },
      ],
    },
    {
      id: 'slope_inference',
      group: 'inference',
      labelZh: '斜率 t 值与 95% 区间',
      labelEn: 'Slope t-statistic and 95% interval',
      latex: String.raw`t_{HAC}=\frac{\hat{\beta}}{SE_{HAC}(\hat{\beta})},\quad CI_{95\%}=\hat{\beta}\pm1.959964\,SE_{HAC}(\hat{\beta})`,
      variables: [
        {
          symbol: 'SE_{HAC}(\\hat{\\beta})',
          descriptionZh: '斜率的异方差与自相关稳健标准误',
          descriptionEn: 'Heteroskedasticity and autocorrelation-consistent slope standard error',
        },
        {
          symbol: '1.959964',
          descriptionZh: '代码用于双侧 95% 正态近似区间的临界值',
          descriptionEn:
            'Critical value used by the implementation for a two-sided normal 95% interval',
        },
      ],
    },
    {
      id: 'spearman_correlation',
      group: 'robustness',
      labelZh: 'Spearman 秩相关',
      labelEn: 'Spearman rank correlation',
      latex: String.raw`\rho_s=\operatorname{Corr}(\operatorname{rank}(x_t),\operatorname{rank}(y_t))`,
      variables: [
        {
          symbol: '\\operatorname{rank}(\\cdot)',
          descriptionZh: '并列值使用平均名次的升序秩',
          descriptionEn: 'Ascending rank with average ranks for ties',
        },
      ],
    },
    {
      id: 'rolling_relationship',
      group: 'robustness',
      labelZh: '滚动窗口关系',
      labelEn: 'Rolling-window relationship',
      latex: String.raw`\hat{\beta}^{(w)}_t=\frac{\sum_{j=t-w+1}^{t}(x_j-\bar{x}_{t,w})(y_j-\bar{y}_{t,w})}{\sum_{j=t-w+1}^{t}(x_j-\bar{x}_{t,w})^2},\quad r^{(w)}_t=\operatorname{Corr}_{j=t-w+1:t}(x_j,y_j)`,
      variables: [
        {
          symbol: 'w',
          descriptionZh: '每次滚动估计使用的观测窗口长度',
          descriptionEn: 'Observation window used for each rolling estimate',
        },
        {
          symbol: 't',
          descriptionZh: '当前滚动窗口的结束时点',
          descriptionEn: 'End date of the current rolling window',
        },
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
    zh: ['/docs/help/basics/time-series-relationships', '/docs/help/basics/cross-market-returns'],
    en: ['/docs/help/basics/time-series-relationships', '/docs/help/basics/cross-market-returns'],
  },
} satisfies ResearchProtocolDefinitionV1;

const multivariateTimeSeriesRelationship = {
  id: 'multivariate_time_series_relationship',
  version: 1,
  nameZh: '多变量时间序列关系',
  nameEn: 'Multivariate time-series relationship',
  questionKinds: ['multivariate_time_series_relationship'],
  minimumObservations: 36,
  assumptions: [
    {
      id: 'prespecified_focal_predictor',
      labelZh: '预先指定核心变量',
      labelEn: 'Prespecified focal predictor',
      descriptionZh:
        '正式结论只评价查看结果前指定的一个核心解释变量；控制变量用于调整混杂，不自动筛选显著变量。',
      descriptionEn:
        'The formal conclusion evaluates one focal predictor chosen before results are inspected; controls adjust for confounding and are not automatically selected for significance.',
    },
    {
      id: 'common_complete_cases',
      labelZh: '共同完整样本',
      labelEn: 'Common complete cases',
      descriptionZh: '结果变量和全部解释变量按共同可得时点对齐，任一变量缺失的日期不进入回归。',
      descriptionEn:
        'The outcome and all predictors align on common availability dates; dates missing any variable are excluded.',
    },
    {
      id: 'linear_conditional_mean',
      labelZh: '线性条件均值',
      labelEn: 'Linear conditional mean',
      descriptionZh: '偏回归系数描述控制其他变量后的线性关系，不等同于因果效应。',
      descriptionEn:
        'A partial coefficient describes a linear relationship conditional on the controls, not a causal effect.',
    },
  ],
  parameters: [
    {
      id: 'frequency',
      type: 'enum',
      labelZh: '对齐频率',
      labelEn: 'Alignment frequency',
      descriptionZh: '全部序列共同使用日频或完整月度观测。',
      descriptionEn: 'All series use common daily or complete monthly observations.',
      adjustable: true,
    },
    {
      id: 'predictorLags',
      type: 'integer',
      labelZh: '各变量滞后',
      labelEn: 'Predictor lags',
      descriptionZh: '每个解释变量独立设置领先结果变量的对齐期数。',
      descriptionEn: 'Each predictor independently specifies aligned periods leading the outcome.',
      adjustable: true,
    },
    {
      id: 'rollingWindow',
      type: 'integer',
      labelZh: '滚动窗口',
      labelEn: 'Rolling window',
      descriptionZh: '用固定长度窗口检查核心变量系数的跨时期稳定性。',
      descriptionEn: 'Uses fixed-length windows to assess stability of the focal coefficient.',
      adjustable: true,
    },
    {
      id: 'neweyWestLag',
      type: 'integer',
      labelZh: 'Newey–West 滞后阶数',
      labelEn: 'Newey–West lag',
      descriptionZh: '异方差与序列相关稳健协方差的截断滞后。',
      descriptionEn:
        'Truncation lag for the heteroskedasticity and autocorrelation-consistent covariance.',
      adjustable: true,
    },
  ],
  terminology: [
    {
      id: 'focal_predictor',
      labelZh: '核心解释变量',
      labelEn: 'Focal predictor',
      descriptionZh: '本次研究预先指定、唯一进入结构化结论的解释变量。',
      descriptionEn: 'The prespecified predictor that uniquely receives the structured conclusion.',
    },
    {
      id: 'control_predictor',
      labelZh: '控制变量',
      labelEn: 'Control predictor',
      descriptionZh: '用于区分核心变量独立关系的其他已知维度，不因显著与否自动增删。',
      descriptionEn:
        'A known dimension used to isolate the focal relationship; it is not added or removed based on significance.',
    },
    {
      id: 'partial_r_squared',
      labelZh: '偏 R²',
      labelEn: 'Partial R-squared',
      descriptionZh: '在其他变量已进入模型后，某变量额外解释的剩余变异比例。',
      descriptionEn:
        'The share of remaining variation additionally explained by a predictor after the others are included.',
    },
    {
      id: 'variance_inflation_factor',
      labelZh: '方差膨胀因子（VIF）',
      labelEn: 'Variance inflation factor (VIF)',
      descriptionZh: '衡量一个解释变量可被其他解释变量解释的程度，用于诊断共线性。',
      descriptionEn:
        'Measures how much a predictor is explained by the other predictors and diagnoses collinearity.',
    },
  ],
  formulae: [
    {
      id: 'multivariate_linear_model',
      group: 'core_estimate',
      labelZh: '多变量线性模型',
      labelEn: 'Multivariate linear model',
      latex: String.raw`y_t=\alpha+\sum_{j=1}^{p}\beta_j x_{j,t-k_j}+\varepsilon_t`,
      variables: [
        { symbol: 'y_t', descriptionZh: '第 t 期结果变量', descriptionEn: 'Outcome at t' },
        {
          symbol: 'x_{j,t-k_j}',
          descriptionZh: '滞后 k_j 期的第 j 个解释变量',
          descriptionEn: 'Predictor j lagged by k_j aligned periods',
        },
        {
          symbol: '\\beta_j',
          descriptionZh: '控制其他变量后的偏回归系数',
          descriptionEn: 'Partial coefficient conditional on the other predictors',
        },
      ],
    },
    {
      id: 'frisch_waugh_lovell',
      group: 'core_estimate',
      labelZh: '偏回归（Frisch–Waugh–Lovell）',
      labelEn: 'Partial regression (Frisch–Waugh–Lovell)',
      latex: String.raw`M_Cy=\beta_f M_Cx_f+u,\quad M_C=I-C(C'C)^{-1}C'`,
      variables: [
        { symbol: 'x_f', descriptionZh: '核心解释变量', descriptionEn: 'Focal predictor' },
        {
          symbol: 'C',
          descriptionZh: '常数项与全部控制变量组成的矩阵',
          descriptionEn: 'Matrix containing the intercept and all controls',
        },
        {
          symbol: 'M_C',
          descriptionZh: '剔除控制变量线性影响的残差生成矩阵',
          descriptionEn: 'Residual-maker removing the linear effect of controls',
        },
      ],
    },
    {
      id: 'multivariate_newey_west_covariance',
      group: 'inference',
      labelZh: '多变量 Newey–West HAC 协方差',
      labelEn: 'Multivariate Newey–West HAC covariance',
      latex: String.raw`\widehat{Var}_{HAC}(\hat\beta)=(X'X)^{-1}\hat S(X'X)^{-1}`,
      variables: [
        {
          symbol: 'X',
          descriptionZh: '包含常数项和全部解释变量的设计矩阵',
          descriptionEn: 'Design matrix containing the intercept and all predictors',
        },
        {
          symbol: '\\hat S',
          descriptionZh: '使用 Bartlett 权重的长程协方差估计',
          descriptionEn: 'Long-run covariance estimate using Bartlett weights',
        },
      ],
    },
    {
      id: 'partial_coefficient_inference',
      group: 'inference',
      labelZh: '偏回归系数区间',
      labelEn: 'Partial-coefficient interval',
      latex: String.raw`CI_{95\%}(\beta_j)=\hat\beta_j\pm1.959964\,SE_{HAC}(\hat\beta_j)`,
      variables: [
        {
          symbol: 'SE_{HAC}(\\hat\\beta_j)',
          descriptionZh: '第 j 个系数的 HAC 稳健标准误',
          descriptionEn: 'HAC-robust standard error for coefficient j',
        },
      ],
    },
    {
      id: 'partial_r_squared',
      group: 'robustness',
      labelZh: '偏 R²',
      labelEn: 'Partial R-squared',
      latex: String.raw`R^2_{partial,j}=\frac{SSE_{-j}-SSE_{full}}{SSE_{-j}}`,
      variables: [
        {
          symbol: 'SSE_{full}',
          descriptionZh: '包含全部预设变量的残差平方和',
          descriptionEn: 'Residual sum of squares for the full prespecified model',
        },
        {
          symbol: 'SSE_{-j}',
          descriptionZh: '仅移除第 j 个变量后的残差平方和',
          descriptionEn: 'Residual sum of squares after removing predictor j only',
        },
      ],
    },
    {
      id: 'variance_inflation_factor',
      group: 'robustness',
      labelZh: '方差膨胀因子',
      labelEn: 'Variance inflation factor',
      latex: String.raw`VIF_j=\frac{1}{1-R_j^2}`,
      variables: [
        {
          symbol: 'R_j^2',
          descriptionZh: '用其他解释变量回归第 j 个解释变量所得 R²',
          descriptionEn: 'R-squared from regressing predictor j on all other predictors',
        },
      ],
    },
    {
      id: 'rolling_partial_coefficient',
      group: 'robustness',
      labelZh: '滚动偏回归系数',
      labelEn: 'Rolling partial coefficient',
      latex: String.raw`\hat\beta_{f,t}^{(w)}=OLS\!\left(y_{t-w+1:t}\mid x_{1:p,t-w+1:t}\right)_f`,
      variables: [
        {
          symbol: 'w',
          descriptionZh: '滚动窗口观测数',
          descriptionEn: 'Number of observations in each rolling window',
        },
        {
          symbol: 'f',
          descriptionZh: '预先指定的核心解释变量',
          descriptionEn: 'Prespecified focal predictor',
        },
      ],
    },
  ],
  pythonExample: `import pandas as pd
import statsmodels.api as sm

# data columns are outcome, focal, and prespecified controls on common dates
aligned = data[["outcome", "focal", "control"]].dropna()
X = sm.add_constant(aligned[["focal", "control"]])
fit = sm.OLS(aligned["outcome"], X).fit(
    cov_type="HAC", cov_kwds={"maxlags": hac_lag}
)
coefficient_table = fit.summary2().tables[1]

# Diagnose collinearity; do not use VIF to auto-select variables after seeing results.
from statsmodels.stats.outliers_influence import variance_inflation_factor
vif = pd.Series(
    [variance_inflation_factor(X.values, i) for i in range(1, X.shape[1])],
    index=X.columns[1:],
)`,
  helpSlugs: {
    zh: [
      '/docs/help/basics/multivariate-time-series-relationships',
      '/docs/help/basics/cross-market-returns',
    ],
    en: [
      '/docs/help/basics/multivariate-time-series-relationships',
      '/docs/help/basics/cross-market-returns',
    ],
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
      group: 'core_estimate',
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
      id: 'welch_inference',
      group: 'inference',
      labelZh: 'Welch t 检验与 95% 区间',
      labelEn: 'Welch t-test and 95% interval',
      latex: String.raw`t=\frac{\Delta}{SE(\Delta)},\quad \nu=\frac{(v_A+v_B)^2}{\frac{v_A^2}{n_A-1}+\frac{v_B^2}{n_B-1}},\quad CI_{95\%}=\Delta\pm t_{0.975,\nu}SE(\Delta),\quad v_g=\frac{s_g^2}{n_g}`,
      variables: [
        {
          symbol: '\\nu',
          descriptionZh: 'Welch–Satterthwaite 近似自由度',
          descriptionEn: 'Welch–Satterthwaite approximate degrees of freedom',
        },
        {
          symbol: 't_{0.975,\\nu}',
          descriptionZh: '自由度为 ν 的 t 分布双侧 95% 临界值',
          descriptionEn: 'Two-sided 95% Student-t critical value with ν degrees of freedom',
        },
      ],
    },
    {
      id: 'mann_whitney_inference',
      group: 'inference',
      labelZh: 'Mann–Whitney 秩检验',
      labelEn: 'Mann–Whitney rank test',
      latex: String.raw`U_A=R_A-\frac{n_A(n_A+1)}{2},\quad z=\frac{U_A-\frac{n_An_B}{2}-c}{\sqrt{\frac{n_An_B}{12}\left(N+1-\frac{\sum_j(t_j^3-t_j)}{N(N-1)}\right)}},\quad p\approx2[1-\Phi(|z|)]`,
      variables: [
        {
          symbol: 'R_A',
          descriptionZh: '合并两组并对并列值取平均名次后，A 组的秩和',
          descriptionEn: 'Group A rank sum after pooling groups and averaging tied ranks',
        },
        {
          symbol: 't_j',
          descriptionZh: '第 j 组并列值的数量',
          descriptionEn: 'Number of observations in tie group j',
        },
        {
          symbol: 'c',
          descriptionZh: '按 U 相对期望值方向取 ±0.5 的连续性修正',
          descriptionEn: 'Continuity correction of ±0.5 in the direction of U from its expectation',
        },
      ],
    },
    {
      id: 'cohens_d',
      group: 'robustness',
      labelZh: '标准化效应量',
      labelEn: 'Standardized effect size',
      latex: String.raw`d=\frac{\bar{x}_A-\bar{x}_B}{\sqrt{\frac{(n_A-1)s_A^2+(n_B-1)s_B^2}{n_A+n_B-2}}}`,
      variables: [
        { symbol: 'd', descriptionZh: 'Cohen’s d 效应量', descriptionEn: "Cohen's d effect size" },
      ],
    },
    {
      id: 'cliffs_delta',
      group: 'robustness',
      labelZh: 'Cliff’s delta',
      labelEn: "Cliff's delta",
      latex: String.raw`\delta=\frac{2U_A}{n_An_B}-1`,
      variables: [
        {
          symbol: '\\delta',
          descriptionZh: '随机抽取 A 组值大于 B 组值的概率减去小于的概率',
          descriptionEn:
            'Probability that a random A value exceeds B minus the reverse probability',
        },
        {
          symbol: 'U_A',
          descriptionZh: 'A 组的 Mann–Whitney U 统计量',
          descriptionEn: 'Mann–Whitney U statistic for group A',
        },
      ],
    },
    {
      id: 'winsorized_mean_difference',
      group: 'robustness',
      labelZh: '缩尾均值差',
      labelEn: 'Winsorized mean difference',
      latex: String.raw`x^{(p)}_{g,i}=\min\{Q_{g,1-p},\max(Q_{g,p},x_{g,i})\},\quad \Delta_W=\overline{x^{(p)}_A}-\overline{x^{(p)}_B}`,
      variables: [
        {
          symbol: 'p',
          descriptionZh: '每一侧的预设缩尾比例',
          descriptionEn: 'Prespecified winsorization fraction in each tail',
        },
        {
          symbol: 'Q_{g,p}',
          descriptionZh: 'g 组使用线性插值得到的 p 分位数',
          descriptionEn: 'Linearly interpolated p-quantile for group g',
        },
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

const eventStudy = {
  id: 'event_study',
  version: 1,
  nameZh: '公告事件研究',
  nameEn: 'Announcement event study',
  questionKinds: ['event_study'],
  minimumObservations: 5,
  assumptions: [
    {
      id: 'public_event_time',
      labelZh: '公开可得事件时点',
      labelEn: 'Publicly available event time',
      descriptionZh: '事件日来自本地分红记录的预案公告日，并映射到当日或其后首个交易日。',
      descriptionEn:
        'The event date is a proposal-stage announcement in the local dividend records and maps to the first trading day on or after it.',
    },
    {
      id: 'market_adjusted_counterfactual',
      labelZh: '市场调整基准',
      labelEn: 'Market-adjusted benchmark',
      descriptionZh: '异常收益定义为股票收益减同期基准收益，不等于严格的因果反事实。',
      descriptionEn:
        'Abnormal return is stock return minus contemporaneous benchmark return; this is not a causal counterfactual.',
    },
    {
      id: 'clustered_event_inference',
      labelZh: '事件日聚类推断',
      labelEn: 'Event-date clustered inference',
      descriptionZh:
        '同一股票窗口重叠时只保留较早事件；区间在事件交易日层面聚类，允许同日公告共享冲击。',
      descriptionEn:
        'Earlier same-stock events are retained when windows overlap; intervals cluster by event trading date so same-day announcements may share shocks.',
    },
  ],
  parameters: [
    {
      id: 'eventWindowStart',
      type: 'integer',
      labelZh: '事件前交易日',
      labelEn: 'Pre-event trading days',
      descriptionZh: '累计异常收益窗口相对事件日的起点。',
      descriptionEn: 'Start of the cumulative-abnormal-return window relative to the event day.',
      adjustable: true,
    },
    {
      id: 'eventWindowEnd',
      type: 'integer',
      labelZh: '事件后交易日',
      labelEn: 'Post-event trading days',
      descriptionZh: '累计异常收益窗口相对事件日的终点。',
      descriptionEn: 'End of the cumulative-abnormal-return window relative to the event day.',
      adjustable: true,
    },
    {
      id: 'benchmark',
      type: 'enum',
      labelZh: '市场基准',
      labelEn: 'Market benchmark',
      descriptionZh: '用于扣除同期市场收益的指数或 ETF。',
      descriptionEn: 'The index or ETF used to remove contemporaneous market return.',
      adjustable: false,
    },
  ],
  terminology: [
    {
      id: 'abnormal_return',
      labelZh: '异常收益（AR）',
      labelEn: 'Abnormal return (AR)',
      descriptionZh: '个股当日简单收益减基准当日简单收益。',
      descriptionEn: 'Stock simple return minus benchmark simple return on the same trading day.',
    },
    {
      id: 'cumulative_abnormal_return',
      labelZh: '累计异常收益（CAR）',
      labelEn: 'Cumulative abnormal return (CAR)',
      descriptionZh: '单个事件在预设窗口内的异常收益之和。',
      descriptionEn: 'The sum of abnormal returns for one event over the prespecified window.',
    },
    {
      id: 'caar',
      labelZh: '累计平均异常收益（CAAR）',
      labelEn: 'Cumulative average abnormal return (CAAR)',
      descriptionZh: '多个事件逐日异常收益取平均后累加形成的路径。',
      descriptionEn:
        'The path formed by cumulatively summing daily abnormal returns averaged across events.',
    },
  ],
  formulae: [
    {
      id: 'market_adjusted_return',
      group: 'core_estimate',
      labelZh: '市场调整异常收益',
      labelEn: 'Market-adjusted abnormal return',
      latex: String.raw`AR_{i,\tau}=R_{i,\tau}-R_{m,\tau}`,
      variables: [
        {
          symbol: 'R_{i,\\tau}',
          descriptionZh: '事件 i 在相对交易日 τ 的个股收益',
          descriptionEn: 'Stock return for event i at relative trading day τ',
        },
        {
          symbol: 'R_{m,\\tau}',
          descriptionZh: '同期基准收益',
          descriptionEn: 'Contemporaneous benchmark return',
        },
      ],
    },
    {
      id: 'cumulative_abnormal_return',
      group: 'core_estimate',
      labelZh: '累计平均异常收益',
      labelEn: 'Cumulative average abnormal return',
      latex: String.raw`CAR_i[a,b]=\sum_{\tau=a}^{b}AR_{i,\tau},\quad CAAR[a,b]=\frac{1}{N}\sum_{i=1}^{N}CAR_i[a,b]`,
      variables: [
        {
          symbol: '[a,b]',
          descriptionZh: '预设事件窗口',
          descriptionEn: 'Prespecified event window',
        },
        {
          symbol: 'N',
          descriptionZh: '有效且不重叠的事件数',
          descriptionEn: 'Valid non-overlapping events',
        },
      ],
    },
    {
      id: 'event_date_clustered_standard_error',
      group: 'inference',
      labelZh: '事件日聚类标准误',
      labelEn: 'Event-date clustered standard error',
      latex: String.raw`SE_{cluster}(\overline{CAR})=\sqrt{\frac{G}{G-1}\frac{1}{N^2}\sum_{g=1}^{G}\left(\sum_{i\in g}(CAR_i-\overline{CAR})\right)^2}`,
      variables: [
        {
          symbol: 'G',
          descriptionZh: '不同事件交易日数',
          descriptionEn: 'Distinct event trading dates',
        },
        {
          symbol: 'g',
          descriptionZh: '共享同一事件交易日的事件簇',
          descriptionEn: 'Events sharing one event trading date',
        },
        {
          symbol: 'N',
          descriptionZh: '有效事件总数',
          descriptionEn: 'Total number of valid events',
        },
      ],
    },
    {
      id: 'event_mean_inference',
      group: 'inference',
      labelZh: '平均 CAR 的 t 值与 95% 区间',
      labelEn: 'Mean-CAR t-statistic and 95% interval',
      latex: String.raw`t=\frac{\overline{CAR}}{SE_{cluster}(\overline{CAR})},\quad CI_{95\%}=\overline{CAR}\pm t_{0.975,G-1}SE_{cluster}(\overline{CAR})`,
      variables: [
        {
          symbol: '\\overline{CAR}',
          descriptionZh: '所有有效事件窗口 CAR 的算术平均值',
          descriptionEn: 'Arithmetic mean CAR across all valid event windows',
        },
        {
          symbol: 't_{0.975,G-1}',
          descriptionZh: '自由度为事件日簇数减一的 t 分布双侧 95% 临界值',
          descriptionEn: 'Two-sided 95% Student-t critical value with G−1 degrees of freedom',
        },
      ],
    },
    {
      id: 'positive_car_fraction',
      group: 'robustness',
      labelZh: '正 CAR 占比',
      labelEn: 'Positive-CAR share',
      latex: String.raw`P_{+}=\frac{1}{N}\sum_{i=1}^{N}\mathbf{1}(CAR_i>0)`,
      variables: [
        {
          symbol: '\\mathbf{1}(\\cdot)',
          descriptionZh: '条件成立时取 1，否则取 0 的指示函数',
          descriptionEn: 'Indicator equal to 1 when the condition holds and 0 otherwise',
        },
      ],
    },
    {
      id: 'winsorized_mean_car',
      group: 'robustness',
      labelZh: '5% 缩尾平均 CAR',
      labelEn: '5% winsorized mean CAR',
      latex: String.raw`CAR_i^{(p)}=\min\{Q_{1-p},\max(Q_p,CAR_i)\},\quad \overline{CAR}_W=\frac{1}{N}\sum_{i=1}^{N}CAR_i^{(p)},\quad p=0.05`,
      variables: [
        {
          symbol: 'Q_p',
          descriptionZh: '事件 CAR 使用线性插值得到的 p 分位数',
          descriptionEn: 'Linearly interpolated p-quantile of event CAR values',
        },
        {
          symbol: 'p=0.05',
          descriptionZh: '代码固定在每一侧使用 5% 缩尾',
          descriptionEn: 'Implementation-fixed 5% winsorization in each tail',
        },
      ],
    },
  ],
  pythonExample: `import numpy as np
import pandas as pd
import statsmodels.api as sm

abnormal = stock_returns.sub(benchmark_returns, axis=0)
event_paths = [abnormal.loc[event_window(event_date)] for event_date in event_dates]
cars = pd.Series([path.sum() for path in event_paths])
mean_car = cars.mean()
fit = sm.OLS(cars, np.ones((len(cars), 1))).fit(
    cov_type="cluster", cov_kwds={"groups": event_trade_dates}, use_t=True
)
interval = fit.conf_int(alpha=0.05)[0]`,
  helpSlugs: {
    zh: ['/docs/help/basics/event-study'],
    en: ['/docs/help/basics/event-study'],
  },
} satisfies ResearchProtocolDefinitionV1;

export const researchCapabilityCatalog: ResearchCapabilityCatalogV1 = {
  version: 1,
  measures,
  universeMeasures: researchUniverseMeasures,
  protocols: [
    timeSeriesRelationship,
    multivariateTimeSeriesRelationship,
    distributionComparison,
    eventStudy,
  ],
};

export const researchMeasureById: ReadonlyMap<string, ResearchMeasureDefinitionV1> = new Map(
  measures.map((measure) => [measure.id, measure]),
);
export const researchProtocolById: ReadonlyMap<string, ResearchProtocolDefinitionV1> = new Map(
  researchCapabilityCatalog.protocols.map((protocol) => [protocol.id, protocol]),
);
export const researchUniverseMeasureById: ReadonlyMap<string, ResearchUniverseMeasureDefinitionV1> =
  new Map(researchUniverseMeasures.map((measure) => [measure.id, measure]));
