import type { FactorAnalysisKind, FactorLanguage } from '@jixie/shared';

export const strategyKey = (key: string, status: string): string | undefined =>
  status === 'published' ? key : undefined;

export const factorLanguage = (language: string): FactorLanguage =>
  language === 'python' ? 'python' : 'typescript';

export function normalizeAnalysisKind(value: string): FactorAnalysisKind {
  switch (value) {
    case 'time_series':
    case 'panel':
    case 'macro_regime':
      return value;
    default:
      return 'cross_sectional';
  }
}
