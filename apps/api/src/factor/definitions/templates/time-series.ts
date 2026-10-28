import type { FactorKind, FactorMeta, Locale } from '@jixie/shared';

/**
 * 定义单资产时间序列模板，供草稿目录与创建入口复用。
 *
 * Describe a time-series template shared by catalog and draft creation.
 */
export interface TimeSeriesTemplate {
  key: string;
  kind: FactorKind;
  targetAssetClasses: Array<'equity' | 'fixed_income' | 'commodity'>;
  defaultAssets: string[];
  label: Record<Locale, string>;
  description: Record<Locale, string>;
  code: string;
  strategyEligible: boolean;
}

const FIXED_INCOME_ETF_ASSETS = ['511010.SH', '511260.SH', '511090.SH'];
const COMMODITY_ETF_ASSETS = ['518880.SH', '159985.SZ', '159980.SZ', '159981.SZ'];
const ALL_TIME_SERIES_ETF_ASSETS = [
  ...FIXED_INCOME_ETF_ASSETS,
  ...COMMODITY_ETF_ASSETS,
  '510300.SH',
];

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

export const TIME_SERIES_TEMPLATES: TimeSeriesTemplate[] = [
  {
    key: 'etf_trend_20',
    kind: 'price',
    targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
    defaultAssets: ALL_TIME_SERIES_ETF_ASSETS,
    label: { zh: 'ETF 20日趋势', en: 'ETF 20-day trend' },
    description: {
      zh: '逐只 ETF 比较自身20个交易日趋势与未来收益，使用复权价格和时间序列稳健推断。',
      en: 'Tests each ETF’s own 20-trading-day trend against its forward return using adjusted prices and robust time-series inference.',
    },
    code: etfTrendCode(20, 'ETF 20-day trend'),
    strategyEligible: true,
  },
  {
    key: 'etf_trend_60',
    kind: 'price',
    targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
    defaultAssets: ALL_TIME_SERIES_ETF_ASSETS,
    label: { zh: 'ETF 60日趋势', en: 'ETF 60-day trend' },
    description: {
      zh: '逐只 ETF 比较自身60个交易日趋势与未来收益，适合研究中期择时。',
      en: 'Tests each ETF’s own 60-trading-day trend against its forward return for medium-term timing research.',
    },
    code: etfTrendCode(60, 'ETF 60-day trend'),
    strategyEligible: true,
  },
  {
    key: 'etf_trend_120',
    kind: 'price',
    targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
    defaultAssets: ALL_TIME_SERIES_ETF_ASSETS,
    label: { zh: 'ETF 120日趋势', en: 'ETF 120-day trend' },
    description: {
      zh: '逐只 ETF 比较自身120个交易日趋势与未来收益，适合研究较慢的趋势状态。',
      en: 'Tests each ETF’s own 120-trading-day trend against its forward return for slower trend regimes.',
    },
    code: etfTrendCode(120, 'ETF 120-day trend'),
    strategyEligible: true,
  },
];

/**
 * 整理单资产时间序列模板的目录信息，供创建草稿时选择。
 *
 * Build catalog metadata for single-asset time-series templates.
 */
export function timeSeriesTemplateCatalog(locale: Locale): FactorMeta[] {
  return TIME_SERIES_TEMPLATES.map((template) => ({
    key: template.key,
    label: template.label[locale],
    description: template.description[locale],
    kind: template.kind,
    builtin: true,
    ...(template.strategyEligible ? { strategyKey: template.key } : {}),
    status: 'published',
    analysisKind: 'time_series',
    targetAssetClasses: template.targetAssetClasses,
    defaultAssets: [...template.defaultAssets],
  }));
}

export function isTimeSeriesTemplateKey(key: string): boolean {
  return TIME_SERIES_TEMPLATES.some((template) => template.key === key);
}
