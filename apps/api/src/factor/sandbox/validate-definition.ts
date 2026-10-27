import { FactorSandbox } from './factor-sandbox.js';
import type { FactorAnalysisKind, FactorLanguage } from '@jixie/shared';
import { validatePythonFactorDefinition } from './python/validator.js';

export type EditableFactorAnalysisKind = Extract<
  FactorAnalysisKind,
  'cross_sectional' | 'time_series' | 'panel'
>;

/**
 * 使用不可变协议指定的编译器校验可编辑因子定义。
 *
 * Validate an editable definition with exactly the compiler selected by its immutable protocol.
 */
export async function validateFactorDefinition(
  code: string,
  analysisKind: EditableFactorAnalysisKind,
  language: FactorLanguage = 'typescript',
): Promise<void> {
  if (language === 'python') {
    return validatePythonFactorDefinition(code, analysisKind);
  }
  const sandbox = await FactorSandbox.start({ language, analysisKind, code });
  sandbox.close();
}
