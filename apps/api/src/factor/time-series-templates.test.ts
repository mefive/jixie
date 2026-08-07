import { describe, expect, it } from 'vitest';
import { compileTimeSeriesFactor } from './compile-time-series-factor.js';
import {
  resolveTimeSeriesTemplateSource,
  timeSeriesTemplateCatalog,
} from './time-series-templates.js';

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
    });
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
