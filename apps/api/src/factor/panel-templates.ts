import type { FactorKind, FactorMeta, Locale } from '@jixie/shared';
import type { FactorAnalysisSource } from './analysis-job.js';

export interface PanelTemplate {
  key: string;
  kind: FactorKind;
  expectedDirection: 'positive' | 'negative';
  targetAssetClasses: Array<'equity' | 'fixed_income' | 'commodity'>;
  label: Record<Locale, string>;
  description: Record<Locale, string>;
  code: string;
  strategyEligible: boolean;
}

const CROSS_ASSET_MOMENTUM_120 = `export default defineFactorV2({
  version: 2,
  name: 'Cross-asset momentum (120d)',
  analysisKind: 'panel',
  outputScope: 'asset',
  frequency: 'daily',
  inputs: ['etf.adjustedClose'],
  targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
  window: 121,
  compute(ctx) {
    const current = ctx.value('etf.adjustedClose');
    const previous = ctx.lag('etf.adjustedClose', 120);
    return current != null && previous != null && previous > 0
      ? current / previous - 1
      : null;
  },
});
`;

const CROSS_ASSET_VOLATILITY_60 = `export default defineFactorV2({
  version: 2,
  name: 'Cross-asset volatility (60d)',
  analysisKind: 'panel',
  outputScope: 'asset',
  frequency: 'daily',
  inputs: ['etf.adjustedClose'],
  targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
  window: 61,
  compute(ctx) {
    const returns = [];
    for (let lag = 0; lag < 60; lag++) {
      const current = ctx.lag('etf.adjustedClose', lag);
      const previous = ctx.lag('etf.adjustedClose', lag + 1);
      if (current == null || previous == null || previous <= 0) return null;
      returns.push(current / previous - 1);
    }
    const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0)
      / (returns.length - 1);
    return Math.sqrt(variance * 252);
  },
});
`;

const COMMODITY_FUTURES_CARRY = `export default defineFactorV2({
  version: 2,
  name: 'Commodity futures annualized carry',
  analysisKind: 'panel',
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

export const PANEL_TEMPLATES: PanelTemplate[] = [
  {
    key: 'cross_asset_momentum_120',
    kind: 'price',
    expectedDirection: 'positive',
    targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
    label: { zh: '跨资产120日动量', en: 'Cross-asset momentum (120d)' },
    description: {
      zh: '在同一月末横向比较境内权益、海外权益、固收和黄金 ETF 的120日动量，并检验下一持有期的排序、换手与成本后多空收益。',
      en: 'Ranks domestic equity, overseas equity, fixed-income, and gold ETFs by 120-day momentum on common month ends, then tests next-period ranks, turnover, and cost-adjusted long-short returns.',
    },
    code: CROSS_ASSET_MOMENTUM_120,
    strategyEligible: true,
  },
  {
    key: 'cross_asset_volatility_60',
    kind: 'price',
    expectedDirection: 'negative',
    targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
    label: { zh: '跨资产60日波动率', en: 'Cross-asset volatility (60d)' },
    description: {
      zh: '在共同月末比较各类 ETF 的60日年化波动率，可作为防御方向的 Panel 成分；研究组合中通常设置为负向。',
      en: 'Compares 60-day annualized volatility across ETFs on common month ends as a defensive panel component, usually aligned with a negative direction.',
    },
    code: CROSS_ASSET_VOLATILITY_60,
    strategyEligible: true,
  },
  {
    key: 'commodity_futures_carry_v1',
    kind: 'commodity',
    expectedDirection: 'positive',
    targetAssetClasses: ['commodity'],
    label: { zh: '商品期货年化 Carry', en: 'Commodity futures annualized carry' },
    description: {
      zh: '在同一月末横向比较黄金、铜、原油和豆粕真实月合约的年化期限结构，并检验映射代理 ETF 的下一持有期收益。正值代表 backwardation；有色和能化代理存在类别基差。',
      en: 'Ranks annualized term-structure carry from actual gold, copper, crude-oil, and soybean-meal contracts on common month ends, then tests the next holding-period returns of mapped proxy ETFs. Positive values mean backwardation; the non-ferrous and energy proxies carry category basis risk.',
    },
    code: COMMODITY_FUTURES_CARRY,
    strategyEligible: false,
  },
];

export function panelTemplateCatalog(locale: Locale): FactorMeta[] {
  return PANEL_TEMPLATES.map((template) => ({
    key: template.key,
    label: template.label[locale],
    description: template.description[locale],
    kind: template.kind,
    builtin: true,
    expectedDirection: template.expectedDirection,
    ...(template.strategyEligible ? { strategyKey: template.key } : {}),
    status: 'published',
    analysisKind: 'panel',
    targetAssetClasses: template.targetAssetClasses,
  }));
}

export function resolvePanelTemplateSource(
  key: string,
): Extract<FactorAnalysisSource, { kind: 'panel' }> | null {
  const template = PANEL_TEMPLATES.find((candidate) => candidate.key === key);
  return template ? { kind: 'panel', label: template.label.en, code: template.code } : null;
}

export function panelTemplateResource(key: string, locale: Locale) {
  const template = PANEL_TEMPLATES.find((candidate) => candidate.key === key);
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
        analysisKind: 'panel' as const,
        targetAssetClasses: template.targetAssetClasses,
      }
    : null;
}
