import { type FactorLanguage } from '@jixie/shared';
import {
  compilePanelFactor,
  compileTimeSeriesFactor,
} from '../runtime/typescript/compile-asset-factor.js';
import { pythonFactorTargetAssetClasses } from '../runtime/python/validator.js';

export const strategyKey = (key: string, status: string): string | undefined =>
  status === 'published' ? key : undefined;

export const factorLanguage = (language: string): FactorLanguage =>
  language === 'python' ? 'python' : 'typescript';

export async function customFactorTargetAssetClasses(input: {
  analysisKind: string;
  language: string;
  code: string;
}) {
  if (input.analysisKind !== 'time_series' && input.analysisKind !== 'panel') {
    return ['equity'] as const;
  }
  if (input.language === 'python') {
    return pythonFactorTargetAssetClasses(input.code);
  }
  const compiled =
    input.analysisKind === 'time_series'
      ? await compileTimeSeriesFactor(input.code)
      : await compilePanelFactor(input.code);
  try {
    return [...compiled.targetAssetClasses];
  } finally {
    compiled.dispose();
  }
}
