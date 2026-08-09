import type { FactorMeta, Locale } from '@jixie/shared';
import type { FactorAnalysisSource } from './analysis-job.js';

export interface PanelTemplate {
  key: string;
  expectedDirection: 'positive' | 'negative';
  targetAssetClasses: Array<'equity' | 'fixed_income' | 'commodity'>;
  label: Record<Locale, string>;
  description: Record<Locale, string>;
  code: string;
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

export const PANEL_TEMPLATES: PanelTemplate[] = [
  {
    key: 'cross_asset_momentum_120',
    expectedDirection: 'positive',
    targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
    label: { zh: '跨资产120日动量', en: 'Cross-asset momentum (120d)' },
    description: {
      zh: '在同一月末横向比较境内权益、海外权益、固收和黄金 ETF 的120日动量，并检验下一持有期的排序、换手与成本后多空收益。',
      en: 'Ranks domestic equity, overseas equity, fixed-income, and gold ETFs by 120-day momentum on common month ends, then tests next-period ranks, turnover, and cost-adjusted long-short returns.',
    },
    code: CROSS_ASSET_MOMENTUM_120,
  },
  {
    key: 'cross_asset_volatility_60',
    expectedDirection: 'negative',
    targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
    label: { zh: '跨资产60日波动率', en: 'Cross-asset volatility (60d)' },
    description: {
      zh: '在共同月末比较各类 ETF 的60日年化波动率，可作为防御方向的 Panel 成分；研究组合中通常设置为负向。',
      en: 'Compares 60-day annualized volatility across ETFs on common month ends as a defensive panel component, usually aligned with a negative direction.',
    },
    code: CROSS_ASSET_VOLATILITY_60,
  },
];

export function panelTemplateCatalog(locale: Locale): FactorMeta[] {
  return PANEL_TEMPLATES.map((template) => ({
    key: template.key,
    label: template.label[locale],
    description: template.description[locale],
    kind: 'price',
    builtin: true,
    expectedDirection: template.expectedDirection,
    strategyKey: template.key,
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
        strategyKey: template.key,
        analysisKind: 'panel' as const,
        targetAssetClasses: template.targetAssetClasses,
      }
    : null;
}
