import { type FactorLanguage, factorRuntimeVersion } from '@jixie/shared';
import { z } from 'zod';
import { canonicalJson, sha256 } from '../reports/spec.js';
import {
  factorCompositeDefinitionV1Schema,
  factorPanelCompositeDefinitionV2Schema,
} from '../schema.js';
import type { FactorAnalysisRuntimeSource } from '../composition/composite.js';

export type FactorAnalysisSource =
  | FactorAnalysisRuntimeSource
  | {
      kind: 'time_series';
      label: string;
      code: string;
      language?: FactorLanguage;
      runtimeVersion?: 'ts-v1' | 'py-v1';
    }
  | {
      kind: 'panel';
      label: string;
      code: string;
      language?: FactorLanguage;
      runtimeVersion?: 'ts-v1' | 'py-v1';
    }
  | { kind: 'macro_regime'; label: string; code: string };

export const factorAnalysisRuntimeSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('single'),
    code: z.string().min(1),
    label: z.string().min(1),
    language: z.enum(['typescript', 'python']).optional(),
    runtimeVersion: z.enum(['ts-v1', 'py-v1']).optional(),
  }),
  z.object({
    kind: z.literal('time_series'),
    label: z.string().min(1),
    code: z.string().min(1),
    language: z.enum(['typescript', 'python']).optional(),
    runtimeVersion: z.enum(['ts-v1', 'py-v1']).optional(),
  }),
  z.object({
    kind: z.literal('panel'),
    label: z.string().min(1),
    code: z.string().min(1),
    language: z.enum(['typescript', 'python']).optional(),
    runtimeVersion: z.enum(['ts-v1', 'py-v1']).optional(),
  }),
  z.object({
    kind: z.literal('macro_regime'),
    label: z.string().min(1),
    code: z.string().min(1),
  }),
  z.object({
    kind: z.literal('panel_composite'),
    label: z.string().min(1),
    definition: factorPanelCompositeDefinitionV2Schema,
    components: z
      .array(
        z.object({
          factor: z.string().min(1),
          code: z.string().min(1),
          label: z.string().min(1),
          direction: z.enum(['positive', 'negative']),
          language: z.enum(['typescript', 'python']).optional(),
          runtimeVersion: z.enum(['ts-v1', 'py-v1']).optional(),
        }),
      )
      .min(2)
      .max(5),
  }),
  z.object({
    kind: z.literal('composite'),
    label: z.string().min(1),
    definition: factorCompositeDefinitionV1Schema,
    components: z
      .array(
        z.object({
          factor: z.string().min(1),
          code: z.string().min(1),
          label: z.string().min(1),
          direction: z.enum(['positive', 'negative']),
          language: z.enum(['typescript', 'python']).optional(),
          runtimeVersion: z.enum(['ts-v1', 'py-v1']).optional(),
        }),
      )
      .min(2)
      .max(5),
  }),
]);

export function factorAnalysisSourceSnapshot(source: FactorAnalysisSource): string {
  return source.kind === 'single' ||
    source.kind === 'time_series' ||
    source.kind === 'panel' ||
    source.kind === 'macro_regime'
    ? source.code
    : canonicalJson(source);
}

export function parseFactorAnalysisSourceSnapshot(
  snapshot: string,
  label: string,
  composite: boolean,
  language: FactorLanguage = 'typescript',
): FactorAnalysisSource {
  if (!composite) {
    return {
      kind: 'single',
      code: snapshot,
      label,
      language,
      runtimeVersion: factorRuntimeVersion(language),
    };
  }
  return factorAnalysisRuntimeSourceSchema.parse(JSON.parse(snapshot));
}

export function parseAssetFactorAnalysisSourceSnapshot(
  snapshot: string,
  label: string,
  analysisKind: 'time_series' | 'panel' | 'macro_regime',
  language: FactorLanguage = 'typescript',
): FactorAnalysisSource {
  if (analysisKind === 'panel') {
    try {
      const parsed = factorAnalysisRuntimeSourceSchema.parse(JSON.parse(snapshot));
      if (parsed.kind === 'panel_composite') {
        return parsed;
      }
    } catch {
      // Plain Factor V2 code is not JSON and remains the compatibility path.
    }
  }
  return analysisKind === 'macro_regime'
    ? { kind: analysisKind, code: snapshot, label }
    : {
        kind: analysisKind,
        code: snapshot,
        label,
        language,
        runtimeVersion: factorRuntimeVersion(language),
      };
}

export function factorAnalysisSourceHash(snapshot: string, language: FactorLanguage): string {
  return sha256(language === 'python' ? `py-v1\0${snapshot}` : snapshot);
}

export function factorAnalysisSourceLanguage(source: FactorAnalysisSource): FactorLanguage {
  if (source.kind === 'single' || source.kind === 'time_series' || source.kind === 'panel') {
    return source.language === 'python' ? 'python' : 'typescript';
  }
  return 'typescript';
}
