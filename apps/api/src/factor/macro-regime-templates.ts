import type { FactorMeta, Locale } from '@jixie/shared';
import type { FactorAnalysisSource } from './analysis-job.js';

export const CHINA_GROWTH_INFLATION_REGIME_KEY = 'china_growth_inflation_regime_v1';

const CHINA_GROWTH_INFLATION_REGIME_LABEL: Record<Locale, string> = {
  zh: '中国增长—通胀四象限',
  en: 'China growth-inflation regime',
};

const CHINA_GROWTH_INFLATION_REGIME_DESCRIPTION: Record<Locale, string> = {
  zh: '用制造业 PMI、CPI 同比和 PPI 同比构造月频增长与通胀分数，研究四类宏观状态下多资产 ETF 的条件未来收益。',
  en: 'Builds monthly growth and inflation scores from manufacturing PMI, CPI YoY, and PPI YoY, then studies conditional multi-asset ETF returns across four macro regimes.',
};

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

export function macroRegimeTemplateCatalog(locale: Locale): FactorMeta[] {
  return [
    {
      key: CHINA_GROWTH_INFLATION_REGIME_KEY,
      label: CHINA_GROWTH_INFLATION_REGIME_LABEL[locale],
      description: CHINA_GROWTH_INFLATION_REGIME_DESCRIPTION[locale],
      kind: 'macro',
      builtin: true,
      status: 'published',
      analysisKind: 'macro_regime',
      targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
    },
  ];
}

export function macroRegimeTemplateResource(key: string, locale: Locale) {
  return key === CHINA_GROWTH_INFLATION_REGIME_KEY
    ? {
        id: CHINA_GROWTH_INFLATION_REGIME_KEY,
        key: CHINA_GROWTH_INFLATION_REGIME_KEY,
        name: CHINA_GROWTH_INFLATION_REGIME_LABEL[locale],
        description: CHINA_GROWTH_INFLATION_REGIME_DESCRIPTION[locale],
        code: CHINA_GROWTH_INFLATION_REGIME_CODE,
        builtin: true as const,
        status: 'published' as const,
        analysisKind: 'macro_regime' as const,
        targetAssetClasses: ['equity', 'fixed_income', 'commodity'] as const,
      }
    : null;
}

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
