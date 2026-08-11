import { describe, expect, it } from 'vitest';
import { compileTimeSeriesFactor } from './compile-time-series-factor.js';
import {
  resolveTimeSeriesTemplateSource,
  timeSeriesTemplateAssetPolicy,
  timeSeriesTemplateCatalog,
  timeSeriesTemplateResource,
  unsupportedTimeSeriesTemplateAssets,
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
      'commodity_futures_carry_time_series_v1',
      'commodity_warehouse_pressure_20',
    ]);
    expect(catalog[0]).toMatchObject({
      label: 'ETF 20日趋势',
      kind: 'price',
      builtin: true,
      analysisKind: 'time_series',
      targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
      allowedAssets: expect.arrayContaining(['510300.SH', '511010.SH', '518880.SH']),
      defaultAssets: expect.arrayContaining(['510300.SH', '511010.SH', '518880.SH']),
    });
    expect(timeSeriesTemplateResource('etf_trend_20', 'zh')).toMatchObject({
      key: 'etf_trend_20',
      strategyKey: 'etf_trend_20',
      status: 'published',
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

  it('publishes commodity Carry as a controlled research-only time-series template', async () => {
    expect(
      timeSeriesTemplateCatalog('zh').find(
        (entry) => entry.key === 'commodity_futures_carry_time_series_v1',
      ),
    ).toMatchObject({
      label: '商品期货 Carry 时间序列',
      kind: 'commodity',
      analysisKind: 'time_series',
      targetAssetClasses: ['commodity'],
    });
    expect(
      timeSeriesTemplateResource('commodity_futures_carry_time_series_v1', 'zh'),
    ).not.toHaveProperty('strategyKey');
    const source = resolveTimeSeriesTemplateSource('commodity_futures_carry_time_series_v1');
    const compiled = await compileTimeSeriesFactor(source!.code);
    try {
      expect(compiled).toMatchObject({
        analysisKind: 'time_series',
        window: 2,
        inputs: ['commodity.futures.annualizedLogCarry'],
        targetAssetClasses: ['commodity'],
      });
      await expect(
        compiled.computeSeries({ 'commodity.futures.annualizedLogCarry': [-0.1, 0.2] }, [1]),
      ).resolves.toEqual([0.2]);
    } finally {
      compiled.dispose();
    }
  });

  it('publishes warehouse pressure only for auditable single-unit products', async () => {
    const catalogEntry = timeSeriesTemplateCatalog('zh').find(
      (entry) => entry.key === 'commodity_warehouse_pressure_20',
    );
    expect(catalogEntry).toMatchObject({
      label: '商品仓单压力 20 日',
      allowedAssets: ['518880.SH', '159980.SZ', '159985.SZ'],
      defaultAssets: ['518880.SH', '159980.SZ', '159985.SZ'],
      unavailableAssetReasons: {
        '159981.SZ': expect.stringContaining('吨和桶'),
      },
    });
    expect(timeSeriesTemplateResource('commodity_warehouse_pressure_20', 'zh')).not.toHaveProperty(
      'strategyKey',
    );
    expect(
      unsupportedTimeSeriesTemplateAssets('commodity_warehouse_pressure_20', [
        '518880.SH',
        '159981.SZ',
      ]),
    ).toEqual(['159981.SZ']);

    const source = resolveTimeSeriesTemplateSource('commodity_warehouse_pressure_20');
    const compiled = await compileTimeSeriesFactor(source!.code);
    try {
      expect(compiled).toMatchObject({
        analysisKind: 'time_series',
        window: 21,
        inputs: ['commodity.warehouseReceipt.volume'],
        targetAssetClasses: ['commodity'],
      });
      await expect(
        compiled.computeSeries(
          {
            'commodity.warehouseReceipt.volume': [100, ...Array.from({ length: 19 }, () => 90), 80],
          },
          [20],
        ),
      ).resolves.toEqual([Math.log1p(100) - Math.log1p(80)]);
    } finally {
      compiled.dispose();
    }
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
