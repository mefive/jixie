import { prisma } from '#infra/database/prisma.js';
import type { Locale } from '@jixie/shared';
import { FactorError } from '../errors.js';
import { customFactorTargetAssetClasses } from '../runtime/inspect-definition.js';
import { BUILTIN_USER_ID } from './builtin-factors.js';
import { macroRegimeTemplateResource } from './templates/macro-regime.js';
import { panelTemplateResource } from './templates/panel.js';
import { timeSeriesTemplateResource } from './templates/time-series.js';
import { strategyKey } from './views.js';

export async function listCustomFactors(userId: string) {
  const rows = await prisma.factor.findMany({
    where: { userId },
    select: {
      id: true,
      key: true,
      name: true,
      analysisKind: true,
      language: true,
      runtimeVersion: true,
      status: true,
      visibility: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  return rows;
}

export async function readFactorDefinition(userId: string, factorId: string, locale: Locale) {
  // Own factors are editable; builtin (preset) rows are readable by anyone — the UI shows their
  // code read-only with a "copy as custom" affordance.
  const timeSeriesTemplate = timeSeriesTemplateResource(factorId, locale);

  if (timeSeriesTemplate) {
    return timeSeriesTemplate;
  }

  const panelTemplate = panelTemplateResource(factorId, locale);

  if (panelTemplate) {
    return panelTemplate;
  }

  const macroRegimeTemplate = macroRegimeTemplateResource(factorId, locale);

  if (macroRegimeTemplate) {
    return macroRegimeTemplate;
  }

  const row = await prisma.factor.findFirst({
    where: {
      id: factorId,
      OR: [
        { userId: { in: [userId, BUILTIN_USER_ID] } },
        { visibility: 'public', status: 'published' },
      ],
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
      visibility: true,
    },
  });

  if (!row) {
    throw new FactorError('factor_not_found');
  }

  const { userId: ownerId, ...rest } = row;
  const targetAssetClasses = await customFactorTargetAssetClasses(rest);

  return {
    ...rest,
    targetAssetClasses,
    messages: ownerId === userId ? row.messages : null,
    researchHandoff: ownerId === userId ? row.researchHandoff : null,
    sourceResearchExecution:
      ownerId === userId && row.sourceResearchExecution
        ? {
            ...row.sourceResearchExecution,
            promotedAt: row.sourceResearchExecution.promotedAt?.toISOString() ?? null,
          }
        : null,
    description: locale === 'en' ? row.descriptionEn : row.descriptionZh,
    strategyKey: strategyKey(row.key, row.status),
    builtin: ownerId === BUILTIN_USER_ID,
    owned: ownerId === userId,
  };
}
