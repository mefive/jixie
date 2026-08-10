import { describe, expect, it } from 'vitest';
import {
  CHINA_GROWTH_INFLATION_REGIME_CODE,
  CHINA_GROWTH_INFLATION_REGIME_KEY,
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
});
