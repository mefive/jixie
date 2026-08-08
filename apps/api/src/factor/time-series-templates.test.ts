import { describe, expect, it } from 'vitest';
import { compileTimeSeriesFactor } from './compile-time-series-factor.js';
import {
  resolveTimeSeriesTemplateSource,
  timeSeriesTemplateCatalog,
  timeSeriesTemplateResource,
} from './time-series-templates.js';

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
    });
    expect(timeSeriesTemplateResource('etf_trend_20', 'zh')).toMatchObject({
      key: 'etf_trend_20',
      strategyKey: 'etf_trend_20',
      status: 'published',
      builtin: true,
    });
  });

  it('publishes fixed-income curve templates with rates-domain definitions', async () => {
    const catalog = timeSeriesTemplateCatalog('zh');
    expect(catalog.find((entry) => entry.key === 'cgb_yield_decline_20')).toMatchObject({
      label: '国债10Y收益率20日下行',
      kind: 'rates',
      targetAssetClasses: ['fixed_income'],
    });
    const slope = resolveTimeSeriesTemplateSource('cgb_curve_slope_10y_2y');
    const compiled = await compileTimeSeriesFactor(slope!.code);
    try {
      expect(compiled).toMatchObject({
        inputs: ['rates.cgb.yield.2y', 'rates.cgb.yield.10y'],
        targetAssetClasses: ['fixed_income'],
      });
    } finally {
      compiled.dispose();
    }
  });

  it('resolves controlled templates to executable frozen Factor V2 sources', async () => {
    const source = resolveTimeSeriesTemplateSource('etf_trend_60');
    expect(source).toMatchObject({
      kind: 'time_series',
      label: 'ETF 60-day trend',
    });
    expect(source?.code).toContain("ctx.lag('etf.adjustedClose', 60)");
    const compiled = await compileTimeSeriesFactor(source!.code);
    try {
      expect(compiled).toMatchObject({
        window: 61,
        inputs: ['etf.adjustedClose'],
        targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
      });
    } finally {
      compiled.dispose();
    }
    expect(resolveTimeSeriesTemplateSource('user_supplied_code')).toBeNull();
  });
});
