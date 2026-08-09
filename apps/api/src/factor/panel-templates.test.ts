import { describe, expect, it } from 'vitest';
import { compilePanelFactor } from './compile-time-series-factor.js';
import {
  panelTemplateCatalog,
  panelTemplateResource,
  resolvePanelTemplateSource,
} from './panel-templates.js';

describe('multi-asset panel templates', () => {
  it('publishes an explicit panel method in the localized catalog', () => {
    expect(panelTemplateCatalog('zh')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'cross_asset_volatility_60',
          label: '跨资产60日波动率',
          expectedDirection: 'negative',
          analysisKind: 'panel',
          targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
        }),
      ]),
    );
    expect(panelTemplateCatalog('zh')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'cross_asset_momentum_120',
          label: '跨资产120日动量',
          expectedDirection: 'positive',
          analysisKind: 'panel',
          targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
        }),
      ]),
    );
    expect(panelTemplateResource('cross_asset_momentum_120', 'zh')).toMatchObject({
      key: 'cross_asset_momentum_120',
      strategyKey: 'cross_asset_momentum_120',
      status: 'published',
      builtin: true,
    });
  });

  it('resolves to an executable frozen Factor V2 panel source', async () => {
    const source = resolvePanelTemplateSource('cross_asset_momentum_120');
    expect(source).toMatchObject({ kind: 'panel', label: 'Cross-asset momentum (120d)' });
    const compiled = await compilePanelFactor(source!.code);
    try {
      expect(compiled).toMatchObject({
        analysisKind: 'panel',
        window: 121,
        inputs: ['etf.adjustedClose'],
      });
    } finally {
      compiled.dispose();
    }
  });
});
