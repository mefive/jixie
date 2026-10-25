import { factorRuntimeVersion, type Locale } from '@jixie/shared';
import { getDatabase } from '#infra/database/prisma.js';
import { builtinCatalog, BUILTIN_USER_ID } from './builtin-factors.js';
import { factorCompositeDefinitionSchema } from '@jixie/shared/api/factor';
import { timeSeriesTemplateCatalog } from './templates/time-series.js';
import { panelTemplateCatalog } from './templates/panel.js';
import { macroRegimeTemplateCatalog } from './templates/macro-regime.js';
import { strategyKey, factorLanguage, normalizeAnalysisKind } from './views.js';

/**
 * 组合预置、作者及组合因子目录，按用户访问范围返回。
 *
 * Combine builtin, authored and composite factor catalogs within user access.
 */
export async function listFactorCatalog(userId: string, locale: Locale) {
  // Preset factors (registry identity; code lives on their seeded rows) + this user's custom factors.
  const custom = await getDatabase().factor.findMany({
    where: { userId: userId },
    select: {
      id: true,
      key: true,
      name: true,
      analysisKind: true,
      language: true,
      runtimeVersion: true,
      status: true,
      approvedReportId: true,
      descriptionZh: true,
      descriptionEn: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  /**
   * 将作者因子定义映射为目录元数据。
   *
   * Map an authored factor definition into catalog metadata.
   */
  const customMeta = custom.map((factor) => ({
    key: factor.id,
    label: factor.name,
    description: locale === 'en' ? factor.descriptionEn : factor.descriptionZh,
    strategyKey: strategyKey(factor.key, factor.status),
    approvedReportId: factor.approvedReportId,
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
  const composites = await getDatabase().factorComposite.findMany({
    where: { userId: userId },
    orderBy: { updatedAt: 'desc' },
  });

  /**
   * 将组合因子配置映射为目录元数据。
   *
   * Map a composite factor configuration into catalog metadata.
   */
  const compositeMeta = composites.map((composite) => {
    const definition = factorCompositeDefinitionSchema.parse(composite.definition);
    return {
      key: composite.id,
      label: composite.name,
      kind: 'composite' as const,
      composite: definition,
      factorKey: composite.key ?? undefined,
      approvedReportId: composite.approvedReportId,
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

  const storedPresets = await getDatabase().factor.findMany({
    where: { userId: BUILTIN_USER_ID },
    orderBy: { createdAt: 'asc' },
  });
  const presetMetadata = new Map(
    [
      ...builtinCatalog(),
      ...timeSeriesTemplateCatalog(locale),
      ...panelTemplateCatalog(locale),
    ].map((metadata) => [metadata.key, metadata]),
  );
  const presets = storedPresets.map((row) => {
    const metadata = presetMetadata.get(row.id);
    const language = factorLanguage(row.language);

    return {
      ...(metadata ?? { kind: 'custom' as const, label: row.name }),
      key: row.id,
      builtin: true,
      approvedReportId: row.approvedReportId,
      analysisKind: normalizeAnalysisKind(row.analysisKind),
      language,
      runtimeVersion: factorRuntimeVersion(language),
      status:
        row.status === 'published' || row.status === 'archived' ? row.status : ('draft' as const),
      strategyKey: !metadata || metadata.strategyKey ? strategyKey(row.key, row.status) : undefined,
    };
  });

  return [...presets, ...macroRegimeTemplateCatalog(locale), ...customMeta, ...compositeMeta];
}
