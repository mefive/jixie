import { compilePanelFactor, compileTimeSeriesFactor } from './typescript/compile-asset-factor.js';
import { pythonFactorTargetAssetClasses } from './python/validator.js';

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
