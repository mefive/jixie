import { FactorSandbox } from '../../sandbox/factor-sandbox.js';
import { describe, expect, it } from 'vitest';

import {
  TIME_SERIES_TEMPLATES,
  timeSeriesTemplateAssetPolicy,
  timeSeriesTemplateCatalog,
  unsupportedTimeSeriesTemplateAssets,
} from './time-series.js';

describe('ETF time-series templates', () => {
  it('publishes localized catalog entries with an explicit research method and asset coverage', () => {
    const catalog = timeSeriesTemplateCatalog('zh');

    expect(catalog.map((entry) => entry.key)).toEqual([
      'etf_trend_20',
      'etf_trend_60',
      'etf_trend_120',
      'cgb_yield_decline_20',
      'cgb_curve_slope_10y_2y',
      'cgb_curve_curvature_2y_5y_10y',
    ]);
    expect(catalog[0]).toMatchObject({
      label: 'ETF 20日趋势',
      kind: 'price',
      builtin: true,
      analysisKind: 'time_series',
      targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
      allowedAssets: expect.arrayContaining([
        '510050.SH',
        '510300.SH',
        '159920.SZ',
        '513500.SH',
        '511010.SH',
        '518880.SH',
      ]),
      defaultAssets: expect.arrayContaining(['510300.SH', '511010.SH', '518880.SH']),
    });
    expect(
      timeSeriesTemplateCatalog('zh').find((entry) => entry.key === 'etf_trend_20'),
    ).toMatchObject({
      key: 'etf_trend_20',
      strategyKey: 'etf_trend_20',
      builtin: true,
    });
  });

  it('keeps template research assets explicit, unique, and server-enforceable', () => {
    for (const template of timeSeriesTemplateCatalog('en')) {
      expect(template.allowedAssets?.length).toBeGreaterThan(0);
      expect(new Set(template.allowedAssets).size).toBe(template.allowedAssets?.length);
      expect(template.defaultAssets?.length).toBeGreaterThan(0);
      expect(
        template.defaultAssets?.every((asset) => template.allowedAssets?.includes(asset)),
      ).toBe(true);
    }

    expect(timeSeriesTemplateAssetPolicy('cgb_yield_decline_20')).toEqual({
      allowedAssets: ['511010.SH', '511260.SH', '511090.SH'],
      defaultAssets: ['511010.SH', '511260.SH', '511090.SH'],
    });
    expect(
      unsupportedTimeSeriesTemplateAssets('cgb_yield_decline_20', ['511010.SH', '518880.SH']),
    ).toEqual(['518880.SH']);
    expect(unsupportedTimeSeriesTemplateAssets('custom-factor-id', ['518880.SH'])).toEqual([]);
  });

  it('publishes fixed-income curve templates with rates-domain definitions', async () => {
    const catalog = timeSeriesTemplateCatalog('zh');
    expect(catalog.find((entry) => entry.key === 'cgb_yield_decline_20')).toMatchObject({
      label: '国债10Y收益率20日下行',
      kind: 'rates',
      targetAssetClasses: ['fixed_income'],
    });
    const slope = TIME_SERIES_TEMPLATES.find((entry) => entry.key === 'cgb_curve_slope_10y_2y');
    const sandbox = await FactorSandbox.start({
      language: 'typescript',
      analysisKind: 'time_series',
      code: slope!.code,
    });
    try {
      expect(sandbox.metadata).toMatchObject({
        inputs: ['rates.cgb.yield.2y', 'rates.cgb.yield.10y'],
        targetAssetClasses: ['fixed_income'],
      });
    } finally {
      sandbox.close();
    }
  });

  it('provides executable initial Factor V2 sources', async () => {
    const source = TIME_SERIES_TEMPLATES.find((entry) => entry.key === 'etf_trend_60');
    expect(source).toMatchObject({
      label: { en: 'ETF 60-day trend' },
    });
    expect(source?.code).toContain("ctx.lag('etf.adjustedClose', 60)");
    const sandbox = await FactorSandbox.start({
      language: 'typescript',
      analysisKind: 'time_series',
      code: source!.code,
    });
    try {
      expect(sandbox.metadata).toMatchObject({
        window: 61,
        inputs: ['etf.adjustedClose'],
        targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
      });
    } finally {
      sandbox.close();
    }
    expect(
      TIME_SERIES_TEMPLATES.find((entry) => entry.key === 'user_supplied_code'),
    ).toBeUndefined();
  });
});
