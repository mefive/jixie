import { FactorSandbox } from './factor-sandbox.js';
import { pythonFactorTargetAssetClasses } from './python/validator.js';

/**
 * 静态解析因子目标资产类别，不启动作者运行时。
 *
 * Inspect declared factor asset classes without running authored code.
 */
export async function inspectFactorTargetAssetClasses(input: {
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
  const sandbox = await FactorSandbox.start({
    language: 'typescript',
    analysisKind: input.analysisKind,
    code: input.code,
  });
  try {
    return [...sandbox.metadata.targetAssetClasses];
  } finally {
    sandbox.close();
  }
}
