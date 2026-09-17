import { prisma } from '#infra/database/prisma.js';
import { factorRuntimeVersion, type FactorLanguage, type PublishedFactor } from '@jixie/shared';
import { isResearchOnlyFactorV2Field } from '../definitions/fields.js';
import { factorLanguage, normalizeAnalysisKind } from '../definitions/views.js';
import { FactorError } from '../errors.js';
import {
  compilePythonPanelFactor,
  compilePythonTimeSeriesFactor,
} from '../runtime/python/asset-factor.js';
import {
  compilePanelFactor,
  compileTimeSeriesFactor,
} from '../runtime/typescript/compile-asset-factor.js';
import { factorResearchSpecV1Schema } from '../schema.js';
import { factorAnalysisSourceHash } from '../sources/snapshot.js';

export async function publishFactor(
  userId: string,
  factorId: string,
  approvedReportId: string,
): Promise<PublishedFactor> {
  const factor = await prisma.factor.findFirst({
    where: { id: factorId, userId },
    select: {
      id: true,
      key: true,
      name: true,
      code: true,
      analysisKind: true,
      language: true,
      runtimeVersion: true,
      status: true,
    },
  });
  if (!factor) {
    throw new FactorError('publication_not_found');
  }
  if (factor.status !== 'draft') {
    throw new FactorError('publication_not_draft');
  }

  const report = await prisma.factorReport.findFirst({
    where: { id: approvedReportId, userId, factor: factorId, status: 'done' },
    select: {
      id: true,
      analysisKind: true,
      phase: true,
      revealedAt: true,
      factorCodeSnapshot: true,
      factorCodeHash: true,
      language: true,
      runtimeVersion: true,
      specJson: true,
      payload: true,
    },
  });
  if (
    !report?.factorCodeSnapshot ||
    !report.factorCodeHash ||
    (report.phase === 'holdout' && !report.revealedAt) ||
    normalizeAnalysisKind(report.analysisKind) !== normalizeAnalysisKind(factor.analysisKind) ||
    factorLanguage(report.language) !== factorLanguage(factor.language) ||
    report.runtimeVersion !== factor.runtimeVersion
  ) {
    throw new FactorError('publication_report_invalid');
  }
  if (factor.analysisKind === 'macro_regime' && !macroReportIsPointInTime(report)) {
    throw new FactorError('publication_report_invalid');
  }
  if (
    (factor.analysisKind === 'time_series' || factor.analysisKind === 'panel') &&
    (await assetFactorCodeUsesResearchOnlyInput(
      factor.code,
      factor.analysisKind,
      factorLanguage(factor.language),
    ))
  ) {
    throw new FactorError('publication_report_invalid');
  }

  const language = factorLanguage(factor.language);
  const currentHash = factorAnalysisSourceHash(factor.code, language);
  if (report.factorCodeSnapshot !== factor.code || report.factorCodeHash !== currentHash) {
    throw new FactorError('publication_report_outdated');
  }

  const publishedAt = new Date();
  const updated = await prisma.factor.updateMany({
    where: { id: factorId, userId, status: 'draft' },
    data: {
      status: 'published',
      approvedReportId: report.id,
      codeHash: currentHash,
      publishedAt,
      archivedAt: null,
    },
  });
  if (updated.count !== 1) {
    throw new FactorError('publication_not_draft');
  }

  return {
    id: factor.id,
    key: factor.key,
    name: factor.name,
    analysisKind: normalizeAnalysisKind(factor.analysisKind),
    language,
    runtimeVersion: factorRuntimeVersion(language),
    status: 'published',
    codeHash: currentHash,
    approvedReportId: report.id,
    publishedAt: publishedAt.toISOString(),
    archivedAt: null,
  };
}

async function assetFactorCodeUsesResearchOnlyInput(
  code: string,
  analysisKind: 'time_series' | 'panel',
  language: FactorLanguage,
): Promise<boolean> {
  try {
    const compiled =
      language === 'python'
        ? analysisKind === 'time_series'
          ? await compilePythonTimeSeriesFactor(code)
          : await compilePythonPanelFactor(code)
        : analysisKind === 'time_series'
          ? await compileTimeSeriesFactor(code)
          : await compilePanelFactor(code);
    try {
      return compiled.inputs.some(isResearchOnlyFactorV2Field);
    } finally {
      compiled.dispose();
    }
  } catch {
    return true;
  }
}

function macroReportIsPointInTime(report: {
  specJson: string | null;
  payload: string | null;
}): boolean {
  if (!report.specJson || !report.payload) {
    return false;
  }
  try {
    const parsedSpec = factorResearchSpecV1Schema.safeParse(JSON.parse(report.specJson));
    const payload = JSON.parse(report.payload) as {
      pointInTimeEligible?: unknown;
      futureVintageRows?: unknown;
    };
    return (
      parsedSpec.success &&
      parsedSpec.data.analysisKind === 'macro_regime' &&
      parsedSpec.data.dataPolicy.revisionPolicy === 'as_available' &&
      payload.pointInTimeEligible === true &&
      payload.futureVintageRows === 0
    );
  } catch {
    return false;
  }
}

export async function archiveFactor(userId: string, factorId: string): Promise<PublishedFactor> {
  const archivedAt = new Date();
  const updated = await prisma.factor.updateMany({
    where: { id: factorId, userId, status: 'published' },
    data: { status: 'archived', visibility: 'private', archivedAt },
  });
  if (updated.count === 0) {
    throw new FactorError('factor_not_found');
  }
  const factor = await prisma.factor.findUniqueOrThrow({ where: { id: factorId } });
  return publishedFactorResource(factor);
}

function publishedFactorResource(row: {
  id: string;
  key: string;
  name: string;
  analysisKind: string;
  language: string;
  status: string;
  codeHash: string | null;
  approvedReportId: string | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
}): PublishedFactor {
  if (!row.codeHash || !row.publishedAt) {
    throw new FactorError('publication_not_draft');
  }
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    analysisKind: normalizeAnalysisKind(row.analysisKind),
    language: factorLanguage(row.language),
    runtimeVersion: factorRuntimeVersion(factorLanguage(row.language)),
    status: row.status === 'archived' ? 'archived' : 'published',
    codeHash: row.codeHash,
    approvedReportId: row.approvedReportId,
    publishedAt: row.publishedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}
