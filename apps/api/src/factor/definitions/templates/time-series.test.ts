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

    expect(timeSeriesTemplateAssetPolicy('cgb_yield_decline_20')).toBeNull();
    expect(
      unsupportedTimeSeriesTemplateAssets('etf_trend_20', ['511010.SH', 'not-listed']),
    ).toEqual(['not-listed']);
    expect(unsupportedTimeSeriesTemplateAssets('custom-factor-id', ['518880.SH'])).toEqual([]);
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
