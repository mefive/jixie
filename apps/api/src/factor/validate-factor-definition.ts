import type { FactorAnalysisKind, FactorLanguage } from '@jixie/shared';
import { compileFactor } from './compile-factor.js';
import { compilePanelFactor, compileTimeSeriesFactor } from './compile-time-series-factor.js';
import { isResearchOnlyFactorV2Field } from './factor-v2-fields.js';
import { validatePythonFactorDefinition } from './python-factor-validator.js';

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
  if (analysisKind === 'time_series') {
    const compiled = await compileTimeSeriesFactor(code);
    try {
      if (compiled.inputs.some(isResearchOnlyFactorV2Field)) {
        throw new Error('This input is currently available only as a controlled template.');
      }
    } finally {
      compiled.dispose();
    }
    return;
  }
  if (analysisKind === 'panel') {
    const compiled = await compilePanelFactor(code);
    try {
      if (compiled.inputs.some(isResearchOnlyFactorV2Field)) {
        throw new Error('This input is currently available only as a controlled template.');
      }
    } finally {
      compiled.dispose();
    }
    return;
  }
  const compiled = await compileFactor(code);
  compiled.dispose();
}
