import type { FactorMeta, Locale } from '@jixie/shared';
import type { FactorAnalysisSource } from './analysis-job.js';

export interface TimeSeriesTemplate {
  key: string;
  kind: 'price' | 'rates';
  targetAssetClasses: Array<'equity' | 'fixed_income' | 'commodity'>;
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

function cgbYieldDeclineCode(lookback: 20 | 60): string {
  return `export default defineFactorV2({
  version: 2,
  name: 'China government 10Y yield decline (${lookback}d)',
  analysisKind: 'time_series',
  outputScope: 'asset',
  frequency: 'daily',
  inputs: ['rates.cgb.yield.10y'],
  targetAssetClasses: ['fixed_income'],
  window: ${lookback + 1},
  compute(ctx) {
    const current = ctx.value('rates.cgb.yield.10y');
    const previous = ctx.lag('rates.cgb.yield.10y', ${lookback});
    return current != null && previous != null ? (previous - current) * 100 : null;
  },
});
`;
}

const CGB_SLOPE_CODE = `export default defineFactorV2({
  version: 2,
  name: 'China government 10Y-2Y curve slope',
  analysisKind: 'time_series',
  outputScope: 'asset',
  frequency: 'daily',
  inputs: ['rates.cgb.yield.2y', 'rates.cgb.yield.10y'],
  targetAssetClasses: ['fixed_income'],
  window: 2,
  compute(ctx) {
    const shortYield = ctx.value('rates.cgb.yield.2y');
    const longYield = ctx.value('rates.cgb.yield.10y');
    return shortYield != null && longYield != null ? (longYield - shortYield) * 100 : null;
  },
});
`;

const CGB_CURVATURE_CODE = `export default defineFactorV2({
  version: 2,
  name: 'China government 2Y-5Y-10Y curvature',
  analysisKind: 'time_series',
  outputScope: 'asset',
  frequency: 'daily',
  inputs: ['rates.cgb.yield.2y', 'rates.cgb.yield.5y', 'rates.cgb.yield.10y'],
  targetAssetClasses: ['fixed_income'],
  window: 2,
  compute(ctx) {
    const shortYield = ctx.value('rates.cgb.yield.2y');
    const bellyYield = ctx.value('rates.cgb.yield.5y');
    const longYield = ctx.value('rates.cgb.yield.10y');
    return shortYield != null && bellyYield != null && longYield != null
      ? (2 * bellyYield - shortYield - longYield) * 100
      : null;
  },
});
`;

export const TIME_SERIES_TEMPLATES: TimeSeriesTemplate[] = [
  {
    key: 'etf_trend_20',
    kind: 'price',
    targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
    label: { zh: 'ETF 20日趋势', en: 'ETF 20-day trend' },
    description: {
      zh: '逐只 ETF 比较自身20个交易日趋势与未来收益，使用复权价格和时间序列稳健推断。',
      en: 'Tests each ETF’s own 20-trading-day trend against its forward return using adjusted prices and robust time-series inference.',
    },
    code: etfTrendCode(20, 'ETF 20-day trend'),
  },
  {
    key: 'etf_trend_60',
    kind: 'price',
    targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
    label: { zh: 'ETF 60日趋势', en: 'ETF 60-day trend' },
    description: {
      zh: '逐只 ETF 比较自身60个交易日趋势与未来收益，适合研究中期择时。',
      en: 'Tests each ETF’s own 60-trading-day trend against its forward return for medium-term timing research.',
    },
    code: etfTrendCode(60, 'ETF 60-day trend'),
  },
  {
    key: 'etf_trend_120',
    kind: 'price',
    targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
    label: { zh: 'ETF 120日趋势', en: 'ETF 120-day trend' },
    description: {
      zh: '逐只 ETF 比较自身120个交易日趋势与未来收益，适合研究较慢的趋势状态。',
      en: 'Tests each ETF’s own 120-trading-day trend against its forward return for slower trend regimes.',
    },
    code: etfTrendCode(120, 'ETF 120-day trend'),
  },
  {
    key: 'cgb_yield_decline_20',
    kind: 'rates',
    targetAssetClasses: ['fixed_income'],
    label: { zh: '国债10Y收益率20日下行', en: 'CGB 10Y yield decline (20d)' },
    description: {
      zh: '用财政部国债曲线10年期收益率20个交易日的下降幅度（bp）研究债券 ETF 未来收益；曲线在发布后的下一交易日才可见。',
      en: 'Tests the 20-trading-day decline in the official 10-year China government yield, in basis points, against future bond ETF returns; each curve point is visible from the next trading day.',
    },
    code: cgbYieldDeclineCode(20),
  },
  {
    key: 'cgb_curve_slope_10y_2y',
    kind: 'rates',
    targetAssetClasses: ['fixed_income'],
    label: { zh: '国债曲线斜率（10Y−2Y）', en: 'CGB curve slope (10Y−2Y)' },
    description: {
      zh: '以财政部国债曲线10年与2年收益率之差（bp）研究期限结构状态与债券 ETF 未来收益。',
      en: 'Tests the official 10-year minus 2-year China government yield spread, in basis points, against future bond ETF returns.',
    },
    code: CGB_SLOPE_CODE,
  },
  {
    key: 'cgb_curve_curvature_2y_5y_10y',
    kind: 'rates',
    targetAssetClasses: ['fixed_income'],
    label: { zh: '国债曲线曲率（2Y/5Y/10Y）', en: 'CGB curve curvature (2Y/5Y/10Y)' },
    description: {
      zh: '以 2×5Y−2Y−10Y（bp）衡量财政部国债曲线中段隆起程度，并研究其与债券 ETF 未来收益的关系。',
      en: 'Measures the belly of the official government curve as 2×5Y−2Y−10Y in basis points and tests its relation to future bond ETF returns.',
    },
    code: CGB_CURVATURE_CODE,
  },
];

export function timeSeriesTemplateCatalog(locale: Locale): FactorMeta[] {
  return TIME_SERIES_TEMPLATES.map((template) => ({
    key: template.key,
    label: template.label[locale],
    description: template.description[locale],
    kind: template.kind,
    builtin: true,
    strategyKey: template.key,
    status: 'published',
    analysisKind: 'time_series',
    targetAssetClasses: template.targetAssetClasses,
  }));
}

export function resolveTimeSeriesTemplateSource(
  key: string,
): Extract<FactorAnalysisSource, { kind: 'time_series' }> | null {
  const template = TIME_SERIES_TEMPLATES.find((candidate) => candidate.key === key);
  return template
    ? {
        kind: 'time_series',
        label: template.label.en,
        code: template.code,
      }
    : null;
}

export function isTimeSeriesTemplateKey(key: string): boolean {
  return TIME_SERIES_TEMPLATES.some((template) => template.key === key);
}

export function timeSeriesTemplateResource(key: string, locale: Locale) {
  const template = TIME_SERIES_TEMPLATES.find((candidate) => candidate.key === key);
  return template
    ? {
        id: template.key,
        key: template.key,
        name: template.label[locale],
        description: template.description[locale],
        code: template.code,
        builtin: true as const,
        status: 'published' as const,
        strategyKey: template.key,
        analysisKind: 'time_series' as const,
        targetAssetClasses: template.targetAssetClasses,
      }
    : null;
}
