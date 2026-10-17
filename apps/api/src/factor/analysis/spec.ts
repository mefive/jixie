import type {
  FactorAnalysisSpec,
  FactorAnalysisSpecV2,
  FactorAnalysisSpecV3,
  FactorAnalysisSpecV4,
  FactorAnalysisSpecV5,
  FactorAnalysisSpecV6,
  FactorCompositeDefinitionV1,
  FactorResearchSpecV1,
} from '@jixie/shared';
import { factorAnalysisSpecSchema, factorResearchSpecV1Schema } from '@jixie/shared/api/factor';

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

export const DEFAULT_FACTOR_CROSS_SECTIONAL_INFERENCE_V1: FactorAnalysisSpecV6['inference'] = {
  version: 1,
  standardError: 'newey_west',
  lag: 'automatic',
  confidenceLevel: 0.95,
  famaMacbeth: {
    controlSet: 'cn_equity_style_v1',
    standardization: 'population_zscore',
    minimumPeriods: 12,
    minimumObservationsPerPeriod: 100,
    momentumLookbackTradingDays: 252,
    momentumSkipTradingDays: 21,
  },
};

export function normalizeFactorAnalysisSpec(input: unknown): FactorAnalysisSpec {
  const spec = factorAnalysisSpecSchema.parse(input);

  if (
    spec.version === 2 ||
    spec.version === 3 ||
    spec.version === 4 ||
    spec.version === 5 ||
    spec.version === 6
  ) {
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

export function createDefaultFactorAnalysisSpecV6(input: {
  freq: FactorAnalysisSpecV6['freq'];
  start: string;
  end: string;
  neutral: FactorAnalysisSpecV6['neutral'];
  evaluationScope?: FactorAnalysisSpecV6['evaluationScope'];
  composite?: FactorAnalysisSpecV6['composite'];
}): FactorAnalysisSpecV6 {
  return {
    ...DEFAULT_FACTOR_ANALYSIS_SPEC_V3,
    ...input,
    version: 6,
    universe: { ...DEFAULT_FACTOR_ANALYSIS_SPEC_V3.universe },
    evaluationScope: structuredClone(input.evaluationScope ?? DEFAULT_FACTOR_EVALUATION_SCOPE_V1),
    inference: structuredClone(DEFAULT_FACTOR_CROSS_SECTIONAL_INFERENCE_V1),
    ...(input.composite ? { composite: structuredClone(input.composite) } : {}),
  };
}
