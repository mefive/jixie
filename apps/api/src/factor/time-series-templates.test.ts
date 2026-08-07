import { describe, expect, it } from 'vitest';
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

  it('resolves only controlled templates to worker sources', () => {
    expect(resolveTimeSeriesTemplateSource('etf_trend_60')).toEqual({
      kind: 'etf_trend',
      label: 'ETF 60-day trend',
      lookback: 60,
    });
    expect(resolveTimeSeriesTemplateSource('user_supplied_code')).toBeNull();
  });
});
