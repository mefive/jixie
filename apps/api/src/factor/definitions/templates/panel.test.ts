import { FactorSandbox } from '../../sandbox/factor-sandbox.js';
import { describe, expect, it } from 'vitest';

import { PANEL_TEMPLATES, panelTemplateCatalog } from './panel.js';

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
    expect(
      panelTemplateCatalog('zh').find((entry) => entry.key === 'cross_asset_momentum_120'),
    ).toMatchObject({
      key: 'cross_asset_momentum_120',
      strategyKey: 'cross_asset_momentum_120',
      builtin: true,
    });
  });

  it('omits the retired carry template in both locales', () => {
    for (const locale of ['zh', 'en'] as const) {
      expect(panelTemplateCatalog(locale).map((entry) => entry.key)).not.toContain(
        'commodity_futures_carry_v1',
      );
    }
  });

  it('provides an executable initial Factor V2 panel source', async () => {
    const source = PANEL_TEMPLATES.find((entry) => entry.key === 'cross_asset_momentum_120');
    expect(source).toMatchObject({ label: { en: 'Cross-asset momentum (120d)' } });
    const sandbox = await FactorSandbox.start({
      language: 'typescript',
      analysisKind: 'panel',
      code: source!.code,
    });
    try {
      expect(sandbox.metadata).toMatchObject({
        analysisKind: 'panel',
        window: 121,
        inputs: ['etf.adjustedClose'],
      });
    } finally {
      sandbox.close();
    }
  });
});
