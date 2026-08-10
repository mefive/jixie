import type { FactorAnalysisKind } from '@jixie/shared';
import { compileFactor } from './compile-factor.js';
import { compilePanelFactor, compileTimeSeriesFactor } from './compile-time-series-factor.js';
import { COMMODITY_CARRY_PANEL_FIELD } from './factor-v2-fields.js';

export type EditableFactorAnalysisKind = Extract<
  FactorAnalysisKind,
  'cross_sectional' | 'time_series' | 'panel'
>;

/** Validate an editable definition with exactly the compiler selected by its immutable protocol. */
export async function validateFactorDefinition(
  code: string,
  analysisKind: EditableFactorAnalysisKind,
): Promise<void> {
  if (analysisKind === 'time_series') {
    const compiled = await compileTimeSeriesFactor(code);
    compiled.dispose();
    return;
  }
  if (analysisKind === 'panel') {
    const compiled = await compilePanelFactor(code);
    try {
      if (compiled.inputs.includes(COMMODITY_CARRY_PANEL_FIELD)) {
        throw new Error('Commodity carry is currently available only as a controlled template.');
      }
    } finally {
      compiled.dispose();
    }
    return;
  }
  const compiled = await compileFactor(code);
  compiled.dispose();
}
