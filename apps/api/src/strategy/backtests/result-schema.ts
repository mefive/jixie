import { MARKET_RISK_FACTOR_KEYS_V1, MACRO_RISK_AXIS_KEYS_V1 } from '@jixie/shared';
import { z } from 'zod';
import type { BacktestResult } from '#engine/types.js';
import type { BacktestSummary } from '@jixie/shared';

const tradeRecordSchema = z.object({
  date: z.string(),
  code: z.string(),
  side: z.enum(['buy', 'sell']),
  shares: z.number(),
  price: z.number(),
  amount: z.number(),
  fee: z.number(),
  slippageCost: z.number().optional(),
  realShares: z.number(),
  realPrice: z.number(),
  assetType: z.enum(['stock', 'etf', 'future']).optional(),
  actualCode: z.string().optional(),
  contracts: z.number().optional(),
  multiplier: z.number().optional(),
});

const factorAnalysisKindSchema = z.enum([
  'cross_sectional',
  'time_series',
  'panel',
  'macro_regime',
]);

const factorDependencySchema = z.object({
  factorId: z.string(),
  key: z.string(),
  name: z.string(),
  analysisKind: factorAnalysisKindSchema,
  language: z.enum(['typescript', 'python']).optional(),
  runtimeVersion: z.enum(['ts-v1', 'py-v1']).optional(),
  codeHash: z.string(),
  approvedReportId: z.union([z.null(), z.string()]).optional(),
  inputs: z.array(z.string()).optional(),
});

const allocationAssetClassSchema = z.enum([
  'cn_equity',
  'overseas_equity',
  'fixed_income',
  'gold',
  'commodity',
  'other',
]);

const allocationContributionRowSchema = z.object({
  assetId: z.string(),
  assetClass: allocationAssetClassSchema,
  averageWeight: z.number(),
  grossPnl: z.number(),
  costs: z.number(),
  netPnl: z.number(),
  returnContribution: z.number(),
  riskContribution: z.union([z.null(), z.number()]),
});

const allocationClassContributionRowSchema = z.object({
  assetClass: allocationAssetClassSchema,
  averageWeight: z.number(),
  grossPnl: z.number(),
  costs: z.number(),
  netPnl: z.number(),
  returnContribution: z.number(),
  riskContribution: z.union([z.null(), z.number()]),
});

const allocationWeightPointSchema = z.object({
  assetId: z.string(),
  assetClass: allocationAssetClassSchema,
  weight: z.number(),
});

const allocationDriftEventSchema = z.object({
  decisionDate: z.string(),
  executionDate: z.string(),
  target: z.array(allocationWeightPointSchema),
  preTrade: z.array(allocationWeightPointSchema),
  postTrade: z.array(allocationWeightPointSchema),
  preTradeDistance: z.number(),
  postTradeDistance: z.number(),
  maxPostTradeDeviation: z.number(),
});

const allocationCorrelationPointSchema = z.object({
  date: z.string(),
  value: z.union([z.null(), z.number()]),
  observations: z.number(),
});

const allocationCorrelationPairSeriesSchema = z.object({
  left: allocationAssetClassSchema,
  right: allocationAssetClassSchema,
  points: z.array(allocationCorrelationPointSchema),
});

const allocationCorrelationWindowSchema = z.object({
  window: z.union([z.literal(60), z.literal(120)]),
  asOfDate: z.string(),
  minimumObservations: z.number(),
  assetClasses: z.array(allocationAssetClassSchema),
  latest: z.array(z.array(z.union([z.null(), z.number()]))),
  latestObservations: z.array(z.array(z.number())),
  series: z.array(allocationCorrelationPairSeriesSchema),
});

const allocationCorrelationAnalysisSchema = z.object({
  methodology: z.literal('equal_weight_asset_class_returns'),
  sampling: z.literal('month_end'),
  minimumCoverage: z.number(),
  windows: z.array(allocationCorrelationWindowSchema),
});

const allocationRateRegimeKeySchema = z.enum([
  'rates_rising_curve_steep',
  'rates_rising_curve_flat',
  'rates_falling_curve_steep',
  'rates_falling_curve_flat',
]);

const allocationRateRegimeClassMetricsSchema = z.object({
  assetClass: allocationAssetClassSchema,
  observations: z.number(),
  meanDailyReturn: z.number(),
  annualizedMeanReturn: z.number(),
  annualizedVolatility: z.number(),
  positiveDayRate: z.number(),
  maximumEpisodeDrawdown: z.number(),
});

const allocationRateRegimeStateSchema = z.object({
  key: allocationRateRegimeKeySchema,
  observations: z.number(),
  episodes: z.number(),
  averageDuration: z.number(),
  assetClasses: z.array(allocationRateRegimeClassMetricsSchema),
});

const allocationRateRegimeAnalysisSchema = z.object({
  methodology: z.literal('cgb_10y_direction_and_10y_2y_relative_slope'),
  pointInTime: z.literal('available_date'),
  directionLookbackObservations: z.literal(60),
  curveMedianLookbackObservations: z.literal(252),
  curveMedianMinimumObservations: z.literal(120),
  classifiedDays: z.number(),
  totalDays: z.number(),
  latest: z.union([
    z.null(),
    z.object({
      asOfDate: z.string(),
      state: allocationRateRegimeKeySchema,
      tenYearYieldPct: z.number(),
      tenYearChangeBp: z.number(),
      curveSlopeBp: z.number(),
      curveMedianBp: z.number(),
    }),
  ]),
  states: z.array(allocationRateRegimeStateSchema),
});

const portfolioMarketRiskExposureV1Schema = z.object({
  factor: z.enum(MARKET_RISK_FACTOR_KEYS_V1),
  coefficient: z.number(),
  coefficientUnit: z.enum(['return_per_return', 'return_per_basis_point']),
  varianceContribution: z.number(),
  varianceContributionShare: z.union([z.null(), z.number()]),
});

const riskDataLineageSeriesV1Schema = z.object({
  seriesKey: z.string(),
  availableThrough: z.string(),
  revisionPolicy: z.enum(['as_available', 'latest_vintage', 'not_revised']),
});

const riskDataLineageV1Schema = z.object({
  dataCutoff: z.string(),
  pointInTimeEligible: z.boolean(),
  futureVintageRows: z.number(),
  series: z.array(riskDataLineageSeriesV1Schema),
});

const portfolioMarketRiskAnalysisV1Schema = z.object({
  version: z.literal(1),
  frequency: z.literal('daily'),
  methodology: z.literal('rolling_multivariate_regression_ewma_covariance'),
  asOfDate: z.string(),
  lookbackObservations: z.number(),
  minimumObservations: z.number(),
  observations: z.number(),
  covarianceHalfLife: z.number(),
  annualizedPortfolioVolatility: z.union([z.null(), z.number()]),
  explainedVariance: z.union([z.null(), z.number()]),
  exposures: z.array(portfolioMarketRiskExposureV1Schema),
  lineage: riskDataLineageV1Schema,
});

const portfolioMacroSensitivityV1Schema = z.object({
  axis: z.enum(MACRO_RISK_AXIS_KEYS_V1),
  coefficient: z.number(),
  neweyWestTStat: z.number(),
  observations: z.number(),
});

const portfolioMacroRiskAnalysisV1Schema = z.object({
  version: z.literal(1),
  frequency: z.literal('monthly'),
  methodology: z.literal('monthly_multivariate_regression_newey_west'),
  asOfDate: z.string(),
  lookbackObservations: z.number(),
  minimumObservations: z.number(),
  observations: z.number(),
  neweyWestLag: z.number(),
  pointInTimeEligible: z.boolean(),
  sensitivities: z.array(portfolioMacroSensitivityV1Schema),
  lineage: riskDataLineageV1Schema,
});

const alphaRiskOverlapV1Schema = z.object({
  alphaFactorKey: z.string(),
  alphaReturnKind: z.enum(['net_long_short', 'strategy_attributed']),
  marketFactor: z.enum(MARKET_RISK_FACTOR_KEYS_V1),
  observations: z.number(),
  correlation: z.number(),
  classification: z.enum(['low', 'material', 'dominant']),
});

const portfolioRiskScenarioShockV1Schema = z.object({
  factor: z.enum(MARKET_RISK_FACTOR_KEYS_V1),
  shock: z.number(),
  unit: z.enum(['decimal_return', 'basis_point_change']),
});

const portfolioRiskScenarioResultV1Schema = z.union([
  z.object({
    key: z.string(),
    asOfDate: z.string(),
    shocks: z.array(portfolioRiskScenarioShockV1Schema),
    estimatedReturnImpact: z.number(),
    methodology: z.literal('linear_factor_shock'),
    kind: z.literal('deterministic'),
  }),
  z.object({
    key: z.string(),
    asOfDate: z.string(),
    shocks: z.array(portfolioRiskScenarioShockV1Schema),
    estimatedReturnImpact: z.number(),
    methodology: z.literal('linear_factor_shock'),
    kind: z.literal('historical'),
    historicalWindow: z.object({
      startDate: z.string(),
      endDate: z.string(),
    }),
  }),
]);

const portfolioRiskAnalysisV1Schema = z.object({
  version: z.literal(1),
  separationPolicy: z.literal('daily_market_risk_and_monthly_macro_sensitivity'),
  market: portfolioMarketRiskAnalysisV1Schema.optional(),
  macro: portfolioMacroRiskAnalysisV1Schema.optional(),
  alphaRiskOverlap: z.array(alphaRiskOverlapV1Schema).optional(),
  scenarios: z.array(portfolioRiskScenarioResultV1Schema).optional(),
});

const allocationAnalysisSchema = z.object({
  version: z.literal(1),
  methodology: z.literal('daily_component_pnl'),
  riskMethodology: z.literal('component_covariance'),
  observations: z.number(),
  reconciliation: z.object({
    portfolioPnl: z.number(),
    attributedNetPnl: z.number(),
    residual: z.number(),
    tolerance: z.number(),
    reconciled: z.boolean(),
  }),
  costs: z.object({
    fees: z.number(),
    slippage: z.number(),
    total: z.number(),
  }),
  assets: z.array(allocationContributionRowSchema),
  assetClasses: z.array(allocationClassContributionRowSchema),
  drift: z.array(allocationDriftEventSchema),
  correlations: allocationCorrelationAnalysisSchema.optional(),
  rateRegimes: allocationRateRegimeAnalysisSchema.optional(),
  risk: portfolioRiskAnalysisV1Schema.optional(),
});

export const backtestSummarySchema = z.object({
  name: z.string(),
  start: z.string(),
  end: z.string(),
  days: z.number(),
  initialCash: z.number(),
  finalValue: z.number(),
  totalReturn: z.number(),
  annReturn: z.number(),
  sharpe: z.number(),
  maxDrawdown: z.number(),
  trades: z.number(),
  tradeLog: z.array(tradeRecordSchema),
  nav: z.array(
    z.object({
      date: z.string(),
      value: z.number(),
    }),
  ),
  sleeveNav: z
    .array(
      z.object({
        date: z.string(),
        stockValue: z.number(),
        futureValue: z.number(),
        futureMargin: z.number(),
        stockGrossExposure: z.number(),
        futureNotional: z.number(),
        netExposure: z.number(),
      }),
    )
    .optional(),
  benchReturn: z.number().optional(),
  excessReturn: z.number().optional(),
  informationRatio: z.number().optional(),
  calmar: z.number().optional(),
  winRate: z.number().optional(),
  profitFactor: z.number().optional(),
  turnover: z.number().optional(),
  totalFees: z.number().optional(),
  totalSlippage: z.number().optional(),
  cost: z
    .object({
      commission: z.number(),
      minCommission: z.number(),
      stampDuty: z.number(),
      transferFee: z.number(),
      slippageBps: z.number(),
      impactCoef: z.number(),
      futureCommissionRate: z.number(),
      futureCloseTodayRate: z.number(),
      futureSlippageTicks: z.number(),
      futureMarginRate: z.number(),
    })
    .optional(),
  monthly: z
    .array(
      z.object({
        month: z.string(),
        ret: z.number(),
      }),
    )
    .optional(),
  factorDependencies: z.array(factorDependencySchema).optional(),
  allocationAnalysis: allocationAnalysisSchema.optional(),
}) satisfies z.ZodType<BacktestSummary>;

/** The cell worker returns the current engine result, including required diagnostics. */
export const backtestResultSchema = backtestSummarySchema
  .required({
    benchReturn: true,
    excessReturn: true,
    informationRatio: true,
    calmar: true,
    winRate: true,
    profitFactor: true,
    turnover: true,
    totalFees: true,
    totalSlippage: true,
    cost: true,
    monthly: true,
  })
  .extend({
    tradeLog: z.array(tradeRecordSchema.required({ slippageCost: true })),
  }) satisfies z.ZodType<BacktestResult>;
