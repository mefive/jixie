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
    expect(panelTemplateCatalog('zh')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'commodity_futures_carry_v1',
          label: '商品期货年化 Carry',
          kind: 'commodity',
          expectedDirection: 'positive',
          analysisKind: 'panel',
          targetAssetClasses: ['commodity'],
        }),
      ]),
    );
    expect(panelTemplateResource('commodity_futures_carry_v1', 'zh')).not.toHaveProperty(
      'strategyKey',
    );
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

  it('compiles the commodity Carry template against the controlled field catalog', async () => {
    const source = resolvePanelTemplateSource('commodity_futures_carry_v1');
    const compiled = await compilePanelFactor(source!.code);
    try {
      expect(compiled).toMatchObject({
        analysisKind: 'panel',
        targetAssetClasses: ['commodity'],
        window: 2,
        inputs: ['commodity.futures.annualizedLogCarry'],
      });
      await expect(
        compiled.computeSeries({ 'commodity.futures.annualizedLogCarry': [-0.1, 0.2] }, [1]),
      ).resolves.toEqual([0.2]);
    } finally {
      compiled.dispose();
    }
  });
});
