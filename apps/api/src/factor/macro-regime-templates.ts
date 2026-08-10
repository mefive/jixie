import type { FactorAnalysisSource } from './analysis-job.js';

export const CHINA_GROWTH_INFLATION_REGIME_KEY = 'china_growth_inflation_regime_v1';

/** Declarative source snapshot for the frozen built-in model; execution stays in the typed evaluator. */
export const CHINA_GROWTH_INFLATION_REGIME_CODE = `export default defineMacroRegime({
  version: 1,
  name: 'China growth-inflation regime V1',
  analysisKind: 'macro_regime',
  frequency: 'monthly',
  inputs: [
    'macro.cn.pmi.manufacturing',
    'macro.cn.cpi.yoy',
    'macro.cn.ppi.yoy',
  ],
  transform: {
    levelWeight: 0.5,
    momentumMonths: 3,
    momentumWeight: 0.5,
    standardizationMonths: 60,
    minimumMonths: 24,
    zScoreCap: 3,
  },
  states: {
    kind: 'threshold',
    growthThreshold: 0,
    inflationThreshold: 0,
  },
});
`;

export function resolveMacroRegimeTemplateSource(
  key: string,
): Extract<FactorAnalysisSource, { kind: 'macro_regime' }> | null {
  return key === CHINA_GROWTH_INFLATION_REGIME_KEY
    ? {
        kind: 'macro_regime',
        label: 'China growth-inflation regime V1',
        code: CHINA_GROWTH_INFLATION_REGIME_CODE,
      }
    : null;
}
