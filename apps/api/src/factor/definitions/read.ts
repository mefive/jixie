import { type Locale } from '@jixie/shared';
import { getDatabase } from '#infra/database/prisma.js';
import { readCodeProposalHistory } from '#agent/conversations/code-proposals.js';
import { FactorError } from '../errors.js';
import { inspectFactorTargetAssetClasses } from '../sandbox/inspect-definition.js';
import { BUILTIN_USER_ID } from './builtin-factors.js';
import { macroRegimeTemplateResource } from './templates/macro-regime.js';
import { panelTemplateCatalog } from './templates/panel.js';
import { timeSeriesTemplateCatalog } from './templates/time-series.js';
import { strategyKey } from './views.js';

export async function listOwnedFactors(userId: string) {
  const rows = await getDatabase().factor.findMany({
    where: { userId },
    select: {
      id: true,
      key: true,
      name: true,
      analysisKind: true,
      language: true,
      runtimeVersion: true,
      status: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  return rows;
}

/**
 * 按访问权限读取因子定义及当前相关状态。
 *
 * Read an authorized factor definition and its related state.
 */
export async function readFactorDefinition(userId: string, factorId: string, locale: Locale) {
  const row = await getDatabase().factor.findFirst({
    where: {
      id: factorId,
      userId: { in: [userId, BUILTIN_USER_ID] },
    },
    select: {
      id: true,
      key: true,
      name: true,
      analysisKind: true,
      language: true,
      runtimeVersion: true,
      status: true,
      approvedReportId: true,
      codeHash: true,
      publishedAt: true,
      archivedAt: true,
      descriptionZh: true,
      descriptionEn: true,
      code: true,
      messages: true,
      researchHandoff: true,
      sourceResearchExecution: {
        select: {
          id: true,
          documentId: true,
          title: true,
          displayName: true,
          sequence: true,
          promotedAt: true,
        },
      },
      userId: true,
    },
  });

  if (!row) {
    const macroTemplate = macroRegimeTemplateResource(factorId, locale);
    if (macroTemplate) {
      return macroTemplate;
    }
    throw new FactorError('factor_not_found');
  }

  const { userId: ownerId, ...rest } = row;
  const preset =
    ownerId === BUILTIN_USER_ID
      ? [...timeSeriesTemplateCatalog(locale), ...panelTemplateCatalog(locale)].find(
          (item) => item.key === factorId,
        )
      : undefined;
  const targetAssetClasses =
    preset?.targetAssetClasses ?? (await inspectFactorTargetAssetClasses(rest));

  return {
    ...rest,
    targetAssetClasses,
    ...(preset
      ? {
          allowedAssets: preset.allowedAssets,
          defaultAssets: preset.defaultAssets,
          unavailableAssetReasons: preset.unavailableAssetReasons,
        }
      : {}),
    messages:
      ownerId === userId
        ? Array.isArray(row.messages)
          ? await readCodeProposalHistory(getDatabase(), userId, 'factor', factorId, row.messages)
          : row.messages
        : null,
    researchHandoff: ownerId === userId ? row.researchHandoff : null,
    sourceResearchExecution:
      ownerId === userId && row.sourceResearchExecution
        ? {
            ...row.sourceResearchExecution,
            promotedAt: row.sourceResearchExecution.promotedAt?.toISOString() ?? null,
          }
        : null,
    description: preset?.description ?? (locale === 'en' ? row.descriptionEn : row.descriptionZh),
    strategyKey: preset && !preset.strategyKey ? undefined : strategyKey(row.key, row.status),
    builtin: ownerId === BUILTIN_USER_ID,
    owned: ownerId === userId,
  };
}
