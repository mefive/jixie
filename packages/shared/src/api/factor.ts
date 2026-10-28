import { z } from 'zod';
import { chatMessagesSchema } from './agent.js';
import { embeddedDataReferencesSchema } from './research.js';

// 研究配置。 / Research configuration.
const factorAnalysisSpecV1Schema = z.object({
  version: z.literal(1),
  freq: z.enum(['month', 'week']),
  start: z.string().regex(/^\d{8}$/),
  end: z.string().regex(/^\d{8}$/),
  neutral: z.enum(['none', 'size']).default('none'),
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
  neutral: z.enum(['none', 'size']).default('none'),
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
  rankingScope: z.literal('global'),
  diagnostics: z
    .array(z.enum(['size_bucket', 'liquidity_bucket']))
    .max(2)
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
  // 拒绝旧组合参数，避免静默退化为单因子计算。 / Reject retired composites instead of silently running a single factor.
  composite: z.never().optional(),
});

export const factorAnalysisSpecSchema = z.discriminatedUnion('version', [
  factorAnalysisSpecV1Schema,
  factorAnalysisSpecV2Schema,
  factorAnalysisSpecV3Schema,
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
]);

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

export type CreateFactorDraftInput = z.output<typeof createFactorDraftSchema>;

export const updateFactorDraftSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).max(40).optional(),
  messages: chatMessagesSchema.optional(),
});

export type UpdateFactorDraftInput = z.output<typeof updateFactorDraftSchema>;

// Metadata.
export const factorMetadataInputSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1).max(20_000),
});

export type FactorMetadataInput = z.output<typeof factorMetadataInputSchema>;

export const factorMetadataBodySchema = factorMetadataInputSchema.omit({ id: true });

// Publication.
export const publishFactorBodySchema = z.object({
  approvedReportId: z.string().trim().min(1).max(80),
});

// Analysis.
export const submitFactorAnalysisSchema = z.object({
  factor: z.string().min(1),
  spec: z.union([factorAnalysisSpecSchema, factorResearchSpecV1Schema]),
});

export type SubmitFactorAnalysisInput = z.output<typeof submitFactorAnalysisSchema>;

// Jobs.
export const factorJobLogsQuerySchema = z.object({ since: z.string().regex(/^\d+$/).optional() });

export type FactorJobLogsQuery = z.output<typeof factorJobLogsQuerySchema>;

// Reports.
export const factorReportListQuerySchema = z.object({
  factor: z.string().min(1),
});

export type FactorReportListQuery = z.output<typeof factorReportListQuerySchema>;

// Agent.
export const factorAgentInputSchema = z.object({
  id: z.string().min(1),
  message: z.string().trim().min(1).max(2000),
  reportId: z.string().min(1).max(128).optional(),
  dataReferences: embeddedDataReferencesSchema,
  code: z.string().min(1).max(20_000),
});

export const factorAgentBodySchema = factorAgentInputSchema.omit({ id: true });

export const factorAgentParamsSchema = z.object({ factorId: factorAgentInputSchema.shape.id });

// Questions.
export const factorQuestionSchema = z.strictObject({
  factorKey: z.string().min(1).max(128),
  dataReferences: embeddedDataReferencesSchema,
  message: z.string().trim().min(1).max(2000),
  reportId: z.string().min(1).max(128).optional(),
});

export const factorQuestionHistorySchema = z.object({
  before: z.coerce.number<string>().int().nonnegative().optional(),
  limit: z.coerce.number<string>().int().min(1).max(100).default(40),
});

export type FactorQuestionHistoryQuery = z.output<typeof factorQuestionHistorySchema>;

// HTTP input types describe values before defaults and transformations.
export type CreateFactorDraftRequest = z.input<typeof createFactorDraftSchema>;
export type UpdateFactorDraftRequest = z.input<typeof updateFactorDraftSchema>;
export type FactorMetadataRequest = z.input<typeof factorMetadataBodySchema>;
export type PublishFactorRequest = z.input<typeof publishFactorBodySchema>;
export type SubmitFactorAnalysisRequest = z.input<typeof submitFactorAnalysisSchema>;
export type FactorJobRequestQuery = z.input<typeof factorJobLogsQuerySchema>;
export type FactorReportListRequestQuery = z.input<typeof factorReportListQuerySchema>;
export type FactorAgentRequest = z.input<typeof factorAgentBodySchema>;
export type FactorAgentRequestParams = z.input<typeof factorAgentParamsSchema>;
export type FactorQuestionRequest = z.input<typeof factorQuestionSchema>;
export type FactorQuestionHistoryRequestQuery = z.input<typeof factorQuestionHistorySchema>;

export { acceptCodeChangeSchema } from './agent.js';
export type { AcceptCodeChangeInput, AcceptCodeChangeRequest } from './agent.js';
