import { z } from 'zod';
import type {
  FactorCompositeDefinition,
  FactorCompositeDefinitionV1,
  FactorPanelCompositeDefinitionV2,
} from '@jixie/shared';
import { chatMessagesSchema } from '#agent/schema.js';
import { embeddedDataReferencesSchema } from '#research/schema.js';

// Research and composite configuration.
const factorAnalysisSpecV1Schema = z.object({
  version: z.literal(1),
  freq: z.enum(['month', 'week']),
  start: z.string().regex(/^\d{8}$/),
  end: z.string().regex(/^\d{8}$/),
  neutral: z.enum(['none', 'size', 'size_industry']).default('none'),
});

const outlierSpecSchema = z.object({
  method: z.enum(['none', 'winsor', 'mad']),
  tailFraction: z.number().min(0).max(0.25),
  madThreshold: z.number().positive().max(20),
});

const factorAnalysisSpecV2Schema = z.object({
  version: z.literal(2),
  freq: z.enum(['month', 'week']),
  start: z.string().regex(/^\d{8}$/),
  end: z.string().regex(/^\d{8}$/),
  neutral: z.enum(['none', 'size', 'size_industry']).default('none'),
  universe: z.object({
    minimumListingDays: z.number().int().min(0).max(3650),
    liquidityDropFraction: z.number().min(0).max(0.9),
    minimumCandidates: z.number().int().min(20).max(5000),
  }),
  missing: z.object({
    minimumWindowCoverage: z.number().min(0.1).max(1),
  }),
  outliers: z.object({
    factorExposure: outlierSpecSchema,
    forwardReturn: outlierSpecSchema,
  }),
  costs: z.object({
    commissionPerSide: z.number().min(0).max(0.05),
    stampDutySellSide: z.number().min(0).max(0.05),
    slippagePerSide: z.number().min(0).max(0.05),
  }),
});

const factorAnalysisSpecV3Schema = factorAnalysisSpecV2Schema.extend({
  version: z.literal(3),
  universe: factorAnalysisSpecV2Schema.shape.universe.extend({
    excludeRiskWarnings: z.boolean(),
    excludePendingDelisting: z.boolean(),
  }),
});

export const factorCompositeDefinitionV1Schema: z.ZodType<FactorCompositeDefinitionV1> = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(80),
    standardization: z.enum(['rank', 'zscore']),
    weighting: z.literal('equal'),
    components: z
      .array(
        z.object({
          factor: z.string().trim().min(1).max(80),
          direction: z.enum(['positive', 'negative']),
        }),
      )
      .min(2)
      .max(5),
  })
  .superRefine((definition, context) => {
    const seen = new Set<string>();
    definition.components.forEach((component, index) => {
      if (seen.has(component.factor)) {
        context.addIssue({
          code: 'custom',
          path: ['components', index, 'factor'],
          message: 'Composite factors must be distinct',
        });
      }
      seen.add(component.factor);
    });
  });

export const factorPanelCompositeDefinitionV2Schema: z.ZodType<FactorPanelCompositeDefinitionV2> = z
  .object({
    version: z.literal(2),
    key: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
    name: z.string().trim().min(1).max(80),
    analysisKind: z.literal('panel'),
    standardization: z.enum(['rank', 'zscore']),
    weighting: z.literal('equal'),
    components: z
      .array(
        z.object({
          factor: z.string().trim().min(1).max(80),
          direction: z.enum(['positive', 'negative']),
        }),
      )
      .min(2)
      .max(5),
  })
  .superRefine((definition, context) => {
    const seen = new Set<string>();
    definition.components.forEach((component, index) => {
      if (seen.has(component.factor)) {
        context.addIssue({
          code: 'custom',
          path: ['components', index, 'factor'],
          message: 'Composite factors must be distinct',
        });
      }
      seen.add(component.factor);
    });
  });

export const factorCompositeDefinitionSchema = z.union([
  factorCompositeDefinitionV1Schema,
  factorPanelCompositeDefinitionV2Schema,
]) as z.ZodType<FactorCompositeDefinition>;

const factorAnalysisSpecV4Schema = factorAnalysisSpecV3Schema.extend({
  version: z.literal(4),
  composite: factorCompositeDefinitionV1Schema,
});

const factorEvaluationScopeV1Schema = z.object({
  version: z.literal(1),
  universe: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('market'), market: z.literal('cn_a') }),
    z.object({
      kind: z.literal('index'),
      indexCode: z.enum(['000300.SH', '000905.SH', '000852.SH']),
    }),
  ]),
  membership: z.literal('point_in_time'),
  rankingScope: z.enum(['global', 'within_industry']),
  diagnostics: z
    .array(z.enum(['industry', 'size_bucket', 'liquidity_bucket']))
    .max(3)
    .refine((items) => new Set(items).size === items.length, 'Diagnostics must be unique.'),
});

const factorAnalysisSpecV5Schema = factorAnalysisSpecV3Schema.extend({
  version: z.literal(5),
  evaluationScope: factorEvaluationScopeV1Schema,
});

const factorCrossSectionalInferenceSpecV1Schema = z.object({
  version: z.literal(1),
  standardError: z.literal('newey_west'),
  lag: z.literal('automatic'),
  confidenceLevel: z.literal(0.95),
  famaMacbeth: z.object({
    controlSet: z.literal('cn_equity_style_v1'),
    standardization: z.literal('population_zscore'),
    minimumPeriods: z.literal(12),
    minimumObservationsPerPeriod: z.literal(100),
    momentumLookbackTradingDays: z.literal(252),
    momentumSkipTradingDays: z.literal(21),
  }),
});

const factorAnalysisSpecV6Schema = factorAnalysisSpecV3Schema.extend({
  version: z.literal(6),
  evaluationScope: factorEvaluationScopeV1Schema,
  inference: factorCrossSectionalInferenceSpecV1Schema,
  composite: factorCompositeDefinitionV1Schema.optional(),
});

export const factorAnalysisSpecSchema = z.discriminatedUnion('version', [
  factorAnalysisSpecV1Schema,
  factorAnalysisSpecV2Schema,
  factorAnalysisSpecV3Schema,
  factorAnalysisSpecV4Schema,
  factorAnalysisSpecV5Schema,
  factorAnalysisSpecV6Schema,
]);

const factorObservationFrequencySchema = z.enum(['daily', 'weekly', 'monthly']);

const factorForwardReturnTargetV1Schema = z.object({
  kind: z.literal('forward_total_return'),
  horizon: z.number().int().positive().max(1200),
  horizonUnit: z.enum(['trade_day', 'calendar_day', 'month']),
});

const factorPointInTimePolicyV1Schema = z.object({
  pointInTime: z.literal(true),
  revisionPolicy: z.literal('as_available'),
  dataCutoff: z
    .string()
    .regex(/^\d{8}$/)
    .nullable(),
});

const macroPointInTimePolicyV1Schema = factorPointInTimePolicyV1Schema.extend({
  revisionPolicy: z.enum(['as_available', 'latest_vintage']),
});

const factorAssetListBaseSchema = z.array(z.string().trim().min(1).max(80));

const factorAssetListSchema = factorAssetListBaseSchema
  .min(1)
  .max(200)
  .refine((assets) => new Set(assets).size === assets.length, 'Assets must be unique.');

const multiAssetClassSchema = z.enum([
  'cn_equity',
  'overseas_equity',
  'fixed_income',
  'gold',
  'commodity',
]);

const datedResearchProtocolShape = {
  version: z.literal(1),
  start: z.string().regex(/^\d{8}$/),
  end: z.string().regex(/^\d{8}$/),
  observationFrequency: factorObservationFrequencySchema,
  target: factorForwardReturnTargetV1Schema,
  dataPolicy: factorPointInTimePolicyV1Schema,
};

export const factorResearchSpecV1Schema = z.discriminatedUnion('analysisKind', [
  z.object({
    version: z.literal(1),
    analysisKind: z.literal('cross_sectional'),
    protocol: factorAnalysisSpecSchema,
  }),
  z.object({
    ...datedResearchProtocolShape,
    analysisKind: z.literal('time_series'),
    assets: factorAssetListSchema,
    inference: z.object({
      standardError: z.literal('newey_west'),
      lag: z.union([z.literal('automatic'), z.number().int().min(0).max(1200)]),
    }),
  }),
  z.object({
    ...datedResearchProtocolShape,
    analysisKind: z.literal('panel'),
    assets: z
      .array(
        z.object({
          assetId: z.string().trim().min(1).max(80),
          assetClass: multiAssetClassSchema,
        }),
      )
      .min(3)
      .max(200)
      .refine(
        (assets) => new Set(assets.map((asset) => asset.assetId)).size === assets.length,
        'Assets must be unique.',
      ),
    rankingScope: z.literal('cross_asset'),
    volatilityScaling: z.enum(['none', 'inverse_volatility']),
    minimumAssetsPerPeriod: z.number().int().min(3).max(200),
    portfolio: z
      .object({
        topFraction: z.number().positive().max(0.5),
        bottomFraction: z.number().positive().max(0.5),
        transactionCostPerSide: z.number().min(0).max(0.05),
      })
      .refine(
        (portfolio) => portfolio.topFraction + portfolio.bottomFraction <= 1,
        'Panel top and bottom fractions cannot overlap.',
      ),
  }),
  z.object({
    ...datedResearchProtocolShape,
    analysisKind: z.literal('macro_regime'),
    dataPolicy: macroPointInTimePolicyV1Schema,
    targetAssets: factorAssetListSchema,
    stateModel: z.object({
      kind: z.enum(['threshold', 'quantile']),
      states: z.number().int().min(2).max(10),
    }),
  }),
]);

const primaryCriterionSchema = z.object({
  metric: z.enum([
    'rank_ic_mean',
    'rank_icir_annual',
    'net_long_short_annualized',
    'time_series_median_newey_west_t',
    'time_series_mean_direction_hit_rate',
    'panel_rank_ic_mean',
    'panel_net_long_short_annualized',
  ]),
  operator: z.enum(['gt', 'lt']),
  value: z.number().finite(),
});

export const factorResearchIntentV1Schema = z
  .object({
    version: z.literal(1),
    mode: z.enum(['hypothesis', 'exploratory']),
    hypothesis: z.string().trim().max(500).optional(),
    rationale: z.string().trim().max(1000).optional(),
    expectedDirection: z.enum(['positive', 'negative', 'unknown']),
    primaryCriterion: primaryCriterionSchema.optional(),
  })
  .superRefine((intent, context) => {
    if (intent.mode !== 'hypothesis') {
      return;
    }
    if (!intent.hypothesis) {
      context.addIssue({ code: 'custom', path: ['hypothesis'], message: 'Hypothesis is required' });
    }
    if (intent.expectedDirection === 'unknown') {
      context.addIssue({
        code: 'custom',
        path: ['expectedDirection'],
        message: 'Direction is required',
      });
    }
    if (!intent.primaryCriterion) {
      context.addIssue({
        code: 'custom',
        path: ['primaryCriterion'],
        message: 'Criterion is required',
      });
    }
  });

// Definitions.
const FACTOR_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

export const createFactorDraftSchema = z.object({
  key: z.string().trim().regex(FACTOR_KEY_PATTERN),
  name: z.string().min(1).max(40),
  code: z.string().min(1),
  analysisKind: z.enum(['cross_sectional', 'time_series', 'panel']).default('cross_sectional'),
  language: z.enum(['typescript', 'python']).default('typescript'),
  messages: chatMessagesSchema.optional(),
});

export const updateFactorDraftSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).max(40).optional(),
  messages: chatMessagesSchema.optional(),
});

// Metadata.
export const factorMetadataInputSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1).max(20_000),
});

export const factorMetadataBodySchema = factorMetadataInputSchema.omit({ id: true });

// Publication.
export const publishFactorBodySchema = z.object({
  approvedReportId: z.string().trim().min(1).max(80),
});

// Visibility.
export const factorVisibilitySchema = z.object({ visibility: z.enum(['private', 'public']) });

// Composites.
export const factorCompositeInputSchema = z.object({ definition: factorCompositeDefinitionSchema });

// Analysis.
export const submitFactorAnalysisSchema = z.object({
  factor: z.string().min(1),
  spec: z.union([factorAnalysisSpecSchema, factorResearchSpecV1Schema]),
  parentReportId: z.string().min(1).nullable().optional(),
  researchIntent: factorResearchIntentV1Schema,
});

// Correlation.
export const factorCorrelationQuerySchema = z.object({
  keys: z
    .string()
    .min(1)
    .transform((value) => value.split(',')),
  freq: z.enum(['month', 'week']).default('month'),
  start: z
    .string()
    .regex(/^\d{8}$/)
    .default('20150101'),
  end: z
    .string()
    .regex(/^\d{8}$/)
    .default('20261231'),
});

export const submitFactorCorrelationSchema = factorCorrelationQuerySchema.extend({
  keys: z.array(z.string()).min(1),
  refresh: z.boolean().default(false),
});

// Jobs.
export const factorJobLogsQuerySchema = z.object({ since: z.string().regex(/^\d+$/).optional() });

// Reports.
export const factorReportListQuerySchema = z.object({
  factor: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export const factorResearchSummaryQuerySchema = z.object({ factor: z.string().min(1).optional() });

// Weather.
export const createFactorWeatherPinSchema = z.object({
  factorId: z.string().min(1),
  direction: z.enum(['positive', 'negative']).optional(),
});

// Agent.
export const factorAgentInputSchema = z.object({
  id: z.string().min(1),
  message: z.string().trim().min(1).max(2000),
  reportId: z.string().min(1).max(128).optional(),
  dataReferences: embeddedDataReferencesSchema,
  code: z.string().min(1).max(20_000),
});

export const factorAgentBodySchema = factorAgentInputSchema.omit({ id: true });

// Questions.
export const factorQuestionSchema = z.strictObject({
  factorKey: z.string().min(1).max(128),
  dataReferences: embeddedDataReferencesSchema,
  message: z.string().trim().min(1).max(2000),
  reportId: z.string().min(1).max(128).optional(),
});

export const factorQuestionHistorySchema = z.object({
  before: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
