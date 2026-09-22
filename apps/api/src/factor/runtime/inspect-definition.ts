import { FactorRuntime } from './factor-runtime.js';
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
  const runtime = await FactorRuntime.start({
    language: 'typescript',
    analysisKind: input.analysisKind,
    code: input.code,
  });
  try {
    return [...runtime.metadata.targetAssetClasses];
  } finally {
    runtime.close();
  }
}
