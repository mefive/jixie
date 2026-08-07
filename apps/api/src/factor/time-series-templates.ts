import type { FactorMeta, Locale } from '@jixie/shared';
import type { FactorAnalysisSource } from './analysis-job.js';

interface EtfTrendTemplate {
  key: string;
  lookback: 20 | 60 | 120;
  label: Record<Locale, string>;
  description: Record<Locale, string>;
}

const ETF_TREND_TEMPLATES: EtfTrendTemplate[] = [
  {
    key: 'etf_trend_20',
    lookback: 20,
    label: { zh: 'ETF 20日趋势', en: 'ETF 20-day trend' },
    description: {
      zh: '逐只 ETF 比较自身20个交易日趋势与未来收益，使用复权价格和时间序列稳健推断。',
      en: 'Tests each ETF’s own 20-trading-day trend against its forward return using adjusted prices and robust time-series inference.',
    },
  },
  {
    key: 'etf_trend_60',
    lookback: 60,
    label: { zh: 'ETF 60日趋势', en: 'ETF 60-day trend' },
    description: {
      zh: '逐只 ETF 比较自身60个交易日趋势与未来收益，适合研究中期择时。',
      en: 'Tests each ETF’s own 60-trading-day trend against its forward return for medium-term timing research.',
    },
  },
  {
    key: 'etf_trend_120',
    lookback: 120,
    label: { zh: 'ETF 120日趋势', en: 'ETF 120-day trend' },
    description: {
      zh: '逐只 ETF 比较自身120个交易日趋势与未来收益，适合研究较慢的趋势状态。',
      en: 'Tests each ETF’s own 120-trading-day trend against its forward return for slower trend regimes.',
    },
  },
];

export function timeSeriesTemplateCatalog(locale: Locale): FactorMeta[] {
  return ETF_TREND_TEMPLATES.map((template) => ({
    key: template.key,
    label: template.label[locale],
    description: template.description[locale],
    kind: 'price',
    builtin: true,
    analysisKind: 'time_series',
    targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
  }));
}

export function resolveTimeSeriesTemplateSource(
  key: string,
): Extract<FactorAnalysisSource, { kind: 'etf_trend' }> | null {
  const template = ETF_TREND_TEMPLATES.find((candidate) => candidate.key === key);
  return template
    ? {
        kind: 'etf_trend',
        label: template.label.en,
        lookback: template.lookback,
      }
    : null;
}
