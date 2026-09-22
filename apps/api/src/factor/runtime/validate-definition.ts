import { FactorRuntime } from './factor-runtime.js';
import { UserCodeError } from '#infra/errors.js';
import type { FactorAnalysisKind, FactorLanguage } from '@jixie/shared';
import { isResearchOnlyFactorV2Field } from '../definitions/fields.js';
import { validatePythonFactorDefinition } from './python/validator.js';

export type EditableFactorAnalysisKind = Extract<
  FactorAnalysisKind,
  'cross_sectional' | 'time_series' | 'panel'
>;

/** Validate an editable definition with exactly the compiler selected by its immutable protocol. */
export async function validateFactorDefinition(
  code: string,
  analysisKind: EditableFactorAnalysisKind,
  language: FactorLanguage = 'typescript',
): Promise<void> {
  if (language === 'python') {
    return validatePythonFactorDefinition(code, analysisKind);
  }
  const runtime = await FactorRuntime.start({ language, analysisKind, code });
  try {
    const metadata = runtime.metadata;
    if (
      metadata.analysisKind !== 'cross_sectional' &&
      metadata.inputs.some(isResearchOnlyFactorV2Field)
    ) {
      throw new UserCodeError('This input is currently available only as a controlled template.');
    }
  } finally {
    runtime.close();
  }
}
