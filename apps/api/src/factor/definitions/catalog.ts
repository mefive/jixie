import { factorRuntimeVersion } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { builtinCatalog } from './builtin-factors.js';
import { factorCompositeDefinitionSchema } from '../reports/spec.js';
import { timeSeriesTemplateCatalog } from './templates/time-series.js';
import { panelTemplateCatalog } from './templates/panel.js';
import { macroRegimeTemplateCatalog } from './templates/macro-regime.js';
import { strategyKey, factorLanguage } from './views.js';
import type { Locale } from '@jixie/shared';

export async function listFactorCatalog(userId: string, locale: Locale) {
  // Preset factors (registry identity; code lives on their seeded rows) + this user's custom factors.
  const custom = await prisma.factor.findMany({
    where: { userId: userId },
    select: {
      id: true,
      key: true,
      name: true,
      analysisKind: true,
      language: true,
      runtimeVersion: true,
      status: true,
      descriptionZh: true,
      descriptionEn: true,
    },
    orderBy: { updatedAt: 'desc' },
  });
  const customMeta = custom.map((factor) => ({
    key: factor.id,
    label: factor.name,
    description: locale === 'en' ? factor.descriptionEn : factor.descriptionZh,
    strategyKey: strategyKey(factor.key, factor.status),
    status:
      factor.status === 'published' || factor.status === 'archived'
        ? factor.status
        : ('draft' as const),
    kind: 'custom' as const,
    analysisKind:
      factor.analysisKind === 'time_series'
        ? ('time_series' as const)
        : factor.analysisKind === 'panel'
          ? ('panel' as const)
          : ('cross_sectional' as const),
    language: factorLanguage(factor.language),
    runtimeVersion: factorRuntimeVersion(factorLanguage(factor.language)),
    targetAssetClasses:
      factor.analysisKind === 'time_series' || factor.analysisKind === 'panel'
        ? (['equity', 'fixed_income', 'commodity'] as const)
        : (['equity'] as const),
  }));
  const composites = await prisma.factorComposite.findMany({
    where: { userId: userId },
    orderBy: { updatedAt: 'desc' },
  });
  const compositeMeta = composites.map((composite) => {
    const definition = factorCompositeDefinitionSchema.parse(composite.definition);
    return {
      key: composite.id,
      label: composite.name,
      kind: 'composite' as const,
      composite: definition,
      factorKey: composite.key ?? undefined,
      strategyKey: strategyKey(composite.key ?? '', composite.status),
      status:
        composite.status === 'published' || composite.status === 'archived'
          ? composite.status
          : ('draft' as const),
      analysisKind: definition.version === 2 ? ('panel' as const) : ('cross_sectional' as const),
      targetAssetClasses:
        definition.version === 2
          ? (['equity', 'fixed_income', 'commodity'] as const)
          : (['equity'] as const),
    };
  });

  return [
    ...builtinCatalog(),
    ...timeSeriesTemplateCatalog(locale),
    ...panelTemplateCatalog(locale),
    ...macroRegimeTemplateCatalog(locale),
    ...customMeta,
    ...compositeMeta,
  ];
}
