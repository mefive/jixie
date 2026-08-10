import { describe, expect, it } from 'vitest';
import {
  CHINA_GROWTH_INFLATION_REGIME_CODE,
  CHINA_GROWTH_INFLATION_REGIME_KEY,
  macroRegimeTemplateCatalog,
  macroRegimeTemplateResource,
  resolveMacroRegimeTemplateSource,
} from './macro-regime-templates.js';

describe('macro regime templates', () => {
  it('resolves the frozen China growth-inflation model by its stable key', () => {
    expect(resolveMacroRegimeTemplateSource(CHINA_GROWTH_INFLATION_REGIME_KEY)).toEqual({
      kind: 'macro_regime',
      label: 'China growth-inflation regime V1',
      code: CHINA_GROWTH_INFLATION_REGIME_CODE,
    });
  });

  it('does not silently substitute an unknown macro model', () => {
    expect(resolveMacroRegimeTemplateSource('unknown_macro_model')).toBeNull();
  });

  it('publishes a localized catalog and read-only resource without a strategy key', () => {
    expect(macroRegimeTemplateCatalog('zh')).toEqual([
      expect.objectContaining({
        key: CHINA_GROWTH_INFLATION_REGIME_KEY,
        label: '中国增长—通胀四象限',
        kind: 'macro',
        analysisKind: 'macro_regime',
        builtin: true,
      }),
    ]);
    expect(macroRegimeTemplateCatalog('zh')[0]).not.toHaveProperty('strategyKey');
    expect(macroRegimeTemplateResource(CHINA_GROWTH_INFLATION_REGIME_KEY, 'en')).toMatchObject({
      id: CHINA_GROWTH_INFLATION_REGIME_KEY,
      name: 'China growth-inflation regime',
      analysisKind: 'macro_regime',
      code: CHINA_GROWTH_INFLATION_REGIME_CODE,
    });
    expect(macroRegimeTemplateResource('unknown_macro_model', 'zh')).toBeNull();
  });
});
