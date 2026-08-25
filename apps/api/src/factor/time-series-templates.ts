import type { FactorKind, FactorMeta, Locale } from '@jixie/shared';
import { MAJOR_ETF_CODES } from '../store/etf-presets.js';
import type { FactorAnalysisSource } from './analysis-job.js';

export interface TimeSeriesTemplate {
  key: string;
  kind: FactorKind;
  targetAssetClasses: Array<'equity' | 'fixed_income' | 'commodity'>;
  allowedAssets: string[];
  defaultAssets: string[];
  unavailableAssetReasons?: Record<string, Record<Locale, string>>;
  label: Record<Locale, string>;
  description: Record<Locale, string>;
  code: string;
  strategyEligible: boolean;
}

const FIXED_INCOME_ETF_ASSETS = ['511010.SH', '511260.SH', '511090.SH'];
const COMMODITY_ETF_ASSETS = ['518880.SH', '159985.SZ', '159980.SZ', '159981.SZ'];
const WAREHOUSE_RECEIPT_ETF_ASSETS = ['518880.SH', '159980.SZ', '159985.SZ'];
const ALL_TIME_SERIES_ETF_ASSETS = [
  ...FIXED_INCOME_ETF_ASSETS,
  ...COMMODITY_ETF_ASSETS,
  '510300.SH',
];
const PRICE_TIME_SERIES_ETF_ASSETS = [...MAJOR_ETF_CODES];

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

const COMMODITY_FUTURES_CARRY_TIME_SERIES = `export default defineFactorV2({
  version: 2,
  name: 'Commodity futures carry time series',
  analysisKind: 'time_series',
  outputScope: 'asset',
  frequency: 'daily',
  inputs: ['commodity.futures.annualizedLogCarry'],
  targetAssetClasses: ['commodity'],
  window: 2,
  compute(ctx) {
    return ctx.value('commodity.futures.annualizedLogCarry');
  },
});
`;

const COMMODITY_WAREHOUSE_RECEIPT_PRESSURE_20 = `export default defineFactorV2({
  version: 2,
  name: 'Commodity warehouse-receipt pressure (20d)',
  analysisKind: 'time_series',
  outputScope: 'asset',
  frequency: 'daily',
  inputs: ['commodity.warehouseReceipt.volume'],
  targetAssetClasses: ['commodity'],
  window: 21,
  compute(ctx) {
    const current = ctx.value('commodity.warehouseReceipt.volume');
    const previous = ctx.lag('commodity.warehouseReceipt.volume', 20);
    return current != null && previous != null
      ? Math.log1p(previous) - Math.log1p(current)
      : null;
  },
});
`;

export const TIME_SERIES_TEMPLATES: TimeSeriesTemplate[] = [
  {
    key: 'etf_trend_20',
    kind: 'price',
    targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
    allowedAssets: PRICE_TIME_SERIES_ETF_ASSETS,
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
    allowedAssets: PRICE_TIME_SERIES_ETF_ASSETS,
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
    allowedAssets: PRICE_TIME_SERIES_ETF_ASSETS,
    defaultAssets: ALL_TIME_SERIES_ETF_ASSETS,
    label: { zh: 'ETF 120日趋势', en: 'ETF 120-day trend' },
    description: {
      zh: '逐只 ETF 比较自身120个交易日趋势与未来收益，适合研究较慢的趋势状态。',
      en: 'Tests each ETF’s own 120-trading-day trend against its forward return for slower trend regimes.',
    },
    code: etfTrendCode(120, 'ETF 120-day trend'),
    strategyEligible: true,
  },
  {
    key: 'cgb_yield_decline_20',
    kind: 'rates',
    targetAssetClasses: ['fixed_income'],
    allowedAssets: FIXED_INCOME_ETF_ASSETS,
    defaultAssets: FIXED_INCOME_ETF_ASSETS,
    label: { zh: '国债10Y收益率20日下行', en: 'CGB 10Y yield decline (20d)' },
    description: {
      zh: '用财政部国债曲线10年期收益率20个交易日的下降幅度（bp）研究债券 ETF 未来收益；曲线在发布后的下一交易日才可见。',
      en: 'Tests the 20-trading-day decline in the official 10-year China government yield, in basis points, against future bond ETF returns; each curve point is visible from the next trading day.',
    },
    code: cgbYieldDeclineCode(20),
    strategyEligible: true,
  },
  {
    key: 'cgb_curve_slope_10y_2y',
    kind: 'rates',
    targetAssetClasses: ['fixed_income'],
    allowedAssets: FIXED_INCOME_ETF_ASSETS,
    defaultAssets: FIXED_INCOME_ETF_ASSETS,
    label: { zh: '国债曲线斜率（10Y−2Y）', en: 'CGB curve slope (10Y−2Y)' },
    description: {
      zh: '以财政部国债曲线10年与2年收益率之差（bp）研究期限结构状态与债券 ETF 未来收益。',
      en: 'Tests the official 10-year minus 2-year China government yield spread, in basis points, against future bond ETF returns.',
    },
    code: CGB_SLOPE_CODE,
    strategyEligible: true,
  },
  {
    key: 'cgb_curve_curvature_2y_5y_10y',
    kind: 'rates',
    targetAssetClasses: ['fixed_income'],
    allowedAssets: FIXED_INCOME_ETF_ASSETS,
    defaultAssets: FIXED_INCOME_ETF_ASSETS,
    label: { zh: '国债曲线曲率（2Y/5Y/10Y）', en: 'CGB curve curvature (2Y/5Y/10Y)' },
    description: {
      zh: '以 2×5Y−2Y−10Y（bp）衡量财政部国债曲线中段隆起程度，并研究其与债券 ETF 未来收益的关系。',
      en: 'Measures the belly of the official government curve as 2×5Y−2Y−10Y in basis points and tests its relation to future bond ETF returns.',
    },
    code: CGB_CURVATURE_CODE,
    strategyEligible: true,
  },
  {
    key: 'commodity_futures_carry_time_series_v1',
    kind: 'commodity',
    targetAssetClasses: ['commodity'],
    allowedAssets: COMMODITY_ETF_ASSETS,
    defaultAssets: COMMODITY_ETF_ASSETS,
    label: { zh: '商品期货 Carry 时间序列', en: 'Commodity futures carry time series' },
    description: {
      zh: '逐个检验黄金、铜、原油和豆粕真实月合约的年化 Carry 与各自映射代理 ETF 未来收益的关系。正值代表 backwardation；有色和能化代理存在类别基差。',
      en: 'Tests each gold, copper, crude-oil, and soybean-meal product’s own annualized actual-contract carry against the future return of its mapped proxy ETF. Positive values mean backwardation; the non-ferrous and energy proxies carry category basis risk.',
    },
    code: COMMODITY_FUTURES_CARRY_TIME_SERIES,
    strategyEligible: false,
  },
  {
    key: 'commodity_warehouse_pressure_20',
    kind: 'commodity',
    targetAssetClasses: ['commodity'],
    allowedAssets: WAREHOUSE_RECEIPT_ETF_ASSETS,
    defaultAssets: WAREHOUSE_RECEIPT_ETF_ASSETS,
    unavailableAssetReasons: {
      '159981.SZ': {
        zh: '原油仓单同时存在吨和桶，缺少可审计换算，暂不进入该 Factor。',
        en: 'Crude-oil receipts mix tonnes and barrels without an auditable conversion, so this Factor excludes them.',
      },
    },
    label: { zh: '商品仓单压力 20 日', en: 'Commodity warehouse pressure (20d)' },
    description: {
      zh: '逐个检验黄金、铜和豆粕仓单在决策日可得的 20 个 ETF 交易观测变化与代理 ETF 未来收益。正值代表仓单下降；原油因吨/桶口径不可审计而排除。',
      en: 'Tests the 20-ETF-observation decline in point-in-time gold, copper, and soybean-meal warehouse receipts against each proxy ETF’s future return. Positive values mean falling receipts; crude oil is excluded because tonne/barrel conversion is not auditable.',
    },
    code: COMMODITY_WAREHOUSE_RECEIPT_PRESSURE_20,
    strategyEligible: false,
  },
];

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
    allowedAssets: [...template.allowedAssets],
    defaultAssets: [...template.defaultAssets],
    ...(template.unavailableAssetReasons
      ? {
          unavailableAssetReasons: Object.fromEntries(
            Object.entries(template.unavailableAssetReasons).map(([assetId, reason]) => [
              assetId,
              reason[locale],
            ]),
          ),
        }
      : {}),
  }));
}

export function timeSeriesTemplateAssetPolicy(
  key: string,
): Pick<TimeSeriesTemplate, 'allowedAssets' | 'defaultAssets'> | null {
  const template = TIME_SERIES_TEMPLATES.find((candidate) => candidate.key === key);
  return template
    ? {
        allowedAssets: [...template.allowedAssets],
        defaultAssets: [...template.defaultAssets],
      }
    : null;
}

export function unsupportedTimeSeriesTemplateAssets(key: string, assets: string[]): string[] {
  const policy = timeSeriesTemplateAssetPolicy(key);
  return policy ? assets.filter((asset) => !policy.allowedAssets.includes(asset)) : [];
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
        ...(template.strategyEligible ? { strategyKey: template.key } : {}),
        analysisKind: 'time_series' as const,
        targetAssetClasses: template.targetAssetClasses,
        allowedAssets: [...template.allowedAssets],
        defaultAssets: [...template.defaultAssets],
        ...(template.unavailableAssetReasons
          ? {
              unavailableAssetReasons: Object.fromEntries(
                Object.entries(template.unavailableAssetReasons).map(([assetId, reason]) => [
                  assetId,
                  reason[locale],
                ]),
              ),
            }
          : {}),
      }
    : null;
}
