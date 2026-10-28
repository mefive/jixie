import { type FactorLanguage } from '@jixie/shared';
import { z } from 'zod';
import { sha256 } from './fingerprint.js';

/**
 * 冻结评估所需因子来源、协议与代码身份，供复现运行。
 *
 * Freeze factor source, protocol and code identity for reproducible evaluation.
 */
export interface FactorAnalysisRuntimeSource {
  kind: 'single';
  code: string;
  label: string;
  language?: FactorLanguage;
  runtimeVersion?: 'ts-v1' | 'py-v1';
}

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
    };

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
]);

export function factorAnalysisSourceSnapshot(source: FactorAnalysisSource): string {
  return source.code;
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
