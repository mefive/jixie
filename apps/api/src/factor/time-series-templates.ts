import type { FactorMeta, Locale } from '@jixie/shared';
import type { FactorAnalysisSource } from './analysis-job.js';

interface EtfTrendTemplate {
  key: string;
  lookback: 20 | 60 | 120;
  label: Record<Locale, string>;
  description: Record<Locale, string>;
  code: string;
}

function etfTrendCode(lookback: 20 | 60 | 120, name: string): string {
  return `export default defineFactorV2({
  version: 2,
  name: '${name}',
  analysisKind: 'time_series',
  outputScope: 'asset',
  frequency: 'daily',
  inputs: ['etf.adjustedClose'],
  targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
  window: ${lookback + 1},
  compute(ctx) {
    const current = ctx.value('etf.adjustedClose');
    const previous = ctx.lag('etf.adjustedClose', ${lookback});
    return current != null && previous != null && previous > 0
      ? current / previous - 1
      : null;
  },
});
`;
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
    code: etfTrendCode(20, 'ETF 20-day trend'),
  },
  {
    key: 'etf_trend_60',
    lookback: 60,
    label: { zh: 'ETF 60日趋势', en: 'ETF 60-day trend' },
    description: {
      zh: '逐只 ETF 比较自身60个交易日趋势与未来收益，适合研究中期择时。',
      en: 'Tests each ETF’s own 60-trading-day trend against its forward return for medium-term timing research.',
    },
    code: etfTrendCode(60, 'ETF 60-day trend'),
  },
  {
    key: 'etf_trend_120',
    lookback: 120,
    label: { zh: 'ETF 120日趋势', en: 'ETF 120-day trend' },
    description: {
      zh: '逐只 ETF 比较自身120个交易日趋势与未来收益，适合研究较慢的趋势状态。',
      en: 'Tests each ETF’s own 120-trading-day trend against its forward return for slower trend regimes.',
    },
    code: etfTrendCode(120, 'ETF 120-day trend'),
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
): Extract<FactorAnalysisSource, { kind: 'time_series' }> | null {
  const template = ETF_TREND_TEMPLATES.find((candidate) => candidate.key === key);
  return template
    ? {
        kind: 'time_series',
        label: template.label.en,
        code: template.code,
      }
    : null;
}

export function isTimeSeriesTemplateKey(key: string): boolean {
  return ETF_TREND_TEMPLATES.some((template) => template.key === key);
}

export function timeSeriesTemplateResource(key: string, locale: Locale) {
  const template = ETF_TREND_TEMPLATES.find((candidate) => candidate.key === key);
  return template
    ? {
        id: template.key,
        name: template.label[locale],
        description: template.description[locale],
        code: template.code,
        builtin: true as const,
        analysisKind: 'time_series' as const,
      }
    : null;
}
