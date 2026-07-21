import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  FactorAnalysisSpec,
  FactorAnalysisSpecV1,
  FactorAnalysisSpecV2,
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

export const factorAnalysisSpecSchema = z.discriminatedUnion('version', [
  factorAnalysisSpecV1Schema,
  factorAnalysisSpecV2Schema,
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

  if (spec.version === 2) {
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

export function createDefaultFactorAnalysisSpecV2(input: {
  freq: FactorAnalysisSpecV2['freq'];
  start: string;
  end: string;
  neutral: FactorAnalysisSpecV2['neutral'];
}): FactorAnalysisSpecV2 {
  return { ...DEFAULT_FACTOR_ANALYSIS_SPEC_V2, ...input };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function factorVariantKey(
  spec: FactorAnalysisSpec,
  factorCodeHash: string,
  dataRevision: string | null = null,
): string {
  return sha256(canonicalJson({ spec, factorCodeHash, dataRevision }));
}

export function factorTestKey(
  spec: FactorAnalysisSpec,
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
