import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  FactorAnalysisSpec,
  FactorAnalysisSpecV2,
  FactorAnalysisSpecV3,
  FactorAnalysisSpecV4,
  FactorAnalysisSpecV5,
  FactorCompositeDefinitionV1,
  FactorResearchSpecV1,
  FactorResearchIntentV1,
} from '@jixie/shared';

export const factorAnalysisSpecV1Schema = z.object({
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

export const factorAnalysisSpecV2Schema = z.object({
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

export const factorAnalysisSpecV3Schema = factorAnalysisSpecV2Schema.extend({
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

export const factorAnalysisSpecV4Schema = factorAnalysisSpecV3Schema.extend({
  version: z.literal(4),
  composite: factorCompositeDefinitionV1Schema,
});

export const factorEvaluationScopeV1Schema = z.object({
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

export const factorAnalysisSpecV5Schema = factorAnalysisSpecV3Schema.extend({
  version: z.literal(5),
  evaluationScope: factorEvaluationScopeV1Schema,
});

export const factorAnalysisSpecSchema = z.discriminatedUnion('version', [
  factorAnalysisSpecV1Schema,
  factorAnalysisSpecV2Schema,
  factorAnalysisSpecV3Schema,
  factorAnalysisSpecV4Schema,
  factorAnalysisSpecV5Schema,
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
    assets: factorAssetListBaseSchema
      .min(2)
      .max(200)
      .refine((assets) => new Set(assets).size === assets.length, 'Assets must be unique.'),
    rankingScope: z.literal('cross_asset'),
    volatilityScaling: z.enum(['none', 'inverse_volatility']),
  }),
  z.object({
    ...datedResearchProtocolShape,
    analysisKind: z.literal('macro_regime'),
    targetAssets: factorAssetListSchema,
    stateModel: z.object({
      kind: z.enum(['threshold', 'quantile']),
      states: z.number().int().min(2).max(10),
    }),
  }),
]);

export const DEFAULT_FACTOR_ANALYSIS_SPEC_V2: Omit<
  FactorAnalysisSpecV2,
  'freq' | 'start' | 'end' | 'neutral'
> = {
  version: 2,
  universe: {
    minimumListingDays: 365,
    liquidityDropFraction: 0.25,
    minimumCandidates: 100,
  },
  missing: {
    minimumWindowCoverage: 2 / 3,
  },
  outliers: {
    factorExposure: { method: 'winsor', tailFraction: 0.01, madThreshold: 5 },
    forwardReturn: { method: 'winsor', tailFraction: 0.01, madThreshold: 5 },
  },
  costs: {
    commissionPerSide: 0.00025,
    stampDutySellSide: 0.0005,
    slippagePerSide: 0.001,
  },
};

export const DEFAULT_FACTOR_ANALYSIS_SPEC_V3: Omit<
  FactorAnalysisSpecV3,
  'freq' | 'start' | 'end' | 'neutral'
> = {
  ...DEFAULT_FACTOR_ANALYSIS_SPEC_V2,
  version: 3,
  universe: {
    ...DEFAULT_FACTOR_ANALYSIS_SPEC_V2.universe,
    excludeRiskWarnings: true,
    excludePendingDelisting: true,
  },
};

export const DEFAULT_FACTOR_EVALUATION_SCOPE_V1: FactorAnalysisSpecV5['evaluationScope'] = {
  version: 1,
  universe: { kind: 'market', market: 'cn_a' },
  membership: 'point_in_time',
  rankingScope: 'global',
  diagnostics: [],
};

const primaryCriterionSchema = z.object({
  metric: z.enum(['rank_ic_mean', 'rank_icir_annual', 'net_long_short_annualized']),
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

export function normalizeFactorAnalysisSpec(input: unknown): FactorAnalysisSpec {
  const spec = factorAnalysisSpecSchema.parse(input);

  if (spec.version === 2 || spec.version === 3 || spec.version === 4 || spec.version === 5) {
    return spec;
  }

  return {
    version: 1,
    freq: spec.freq,
    start: spec.start,
    end: spec.end,
    neutral: spec.neutral,
  };
}

export function normalizeFactorResearchSpec(input: unknown): FactorResearchSpecV1 {
  const unified = factorResearchSpecV1Schema.safeParse(input);
  if (unified.success) {
    return unified.data.analysisKind === 'cross_sectional'
      ? { ...unified.data, protocol: normalizeFactorAnalysisSpec(unified.data.protocol) }
      : unified.data;
  }

  return {
    version: 1,
    analysisKind: 'cross_sectional',
    protocol: normalizeFactorAnalysisSpec(input),
  };
}

export function crossSectionalProtocol(spec: FactorResearchSpecV1): FactorAnalysisSpec {
  if (spec.analysisKind !== 'cross_sectional') {
    throw new Error(
      `Analysis kind ${spec.analysisKind} is not supported by the cross-sectional evaluator.`,
    );
  }
  return spec.protocol;
}

export function createDefaultFactorAnalysisSpecV2(input: {
  freq: FactorAnalysisSpecV2['freq'];
  start: string;
  end: string;
  neutral: FactorAnalysisSpecV2['neutral'];
}): FactorAnalysisSpecV2 {
  return { ...DEFAULT_FACTOR_ANALYSIS_SPEC_V2, ...input };
}

export function createDefaultFactorAnalysisSpecV3(input: {
  freq: FactorAnalysisSpecV3['freq'];
  start: string;
  end: string;
  neutral: FactorAnalysisSpecV3['neutral'];
}): FactorAnalysisSpecV3 {
  return {
    ...DEFAULT_FACTOR_ANALYSIS_SPEC_V3,
    ...input,
    universe: { ...DEFAULT_FACTOR_ANALYSIS_SPEC_V3.universe },
  };
}

export function createDefaultFactorAnalysisSpecV4(input: {
  freq: FactorAnalysisSpecV4['freq'];
  start: string;
  end: string;
  neutral: FactorAnalysisSpecV4['neutral'];
  composite: FactorCompositeDefinitionV1;
}): FactorAnalysisSpecV4 {
  return {
    ...DEFAULT_FACTOR_ANALYSIS_SPEC_V3,
    ...input,
    version: 4,
    universe: { ...DEFAULT_FACTOR_ANALYSIS_SPEC_V3.universe },
  };
}

export function createDefaultFactorAnalysisSpecV5(input: {
  freq: FactorAnalysisSpecV5['freq'];
  start: string;
  end: string;
  neutral: FactorAnalysisSpecV5['neutral'];
  evaluationScope?: FactorAnalysisSpecV5['evaluationScope'];
}): FactorAnalysisSpecV5 {
  return {
    ...DEFAULT_FACTOR_ANALYSIS_SPEC_V3,
    ...input,
    version: 5,
    universe: { ...DEFAULT_FACTOR_ANALYSIS_SPEC_V3.universe },
    evaluationScope: structuredClone(input.evaluationScope ?? DEFAULT_FACTOR_EVALUATION_SCOPE_V1),
  };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function factorVariantKey(
  spec: FactorAnalysisSpec | FactorResearchSpecV1,
  factorCodeHash: string,
  dataRevision: string | null = null,
): string {
  return sha256(canonicalJson({ spec, factorCodeHash, dataRevision }));
}

export function factorTestKey(
  spec: FactorAnalysisSpec | FactorResearchSpecV1,
  factorCodeHash: string,
  intent: FactorResearchIntentV1,
): string {
  const claim = {
    mode: intent.mode,
    expectedDirection: intent.expectedDirection,
    primaryCriterion: intent.primaryCriterion,
  };

  return sha256(canonicalJson({ spec, factorCodeHash, claim }));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJsonValue(child)]),
    );
  }

  return value;
}
