import { isFactorV2FieldKey } from '../definitions/fields.js';
import { factorReportStatusWhere } from '#factor/evaluations/state.js';
import { isRetiredFactorReport } from '#factor/evaluations/report-spec.js';
import { FactorSandbox } from '../sandbox/factor-sandbox.js';
import { getDatabase } from '#infra/database/prisma.js';
import { factorRuntimeVersion, type FactorLanguage, type PublishedFactor } from '@jixie/shared';
import { factorLanguage, normalizeAnalysisKind } from '../definitions/views.js';
import { FactorError } from '../errors.js';
import { factorAnalysisSourceHash } from '../sources/snapshot.js';

/**
 * 校验因子来源、报告及准入状态，再冻结并发布定义。
 *
 * Validate source, report and admission state before freezing and publishing a factor.
 */
export async function publishFactor(
  userId: string,
  factorId: string,
  approvedReportId: string,
): Promise<PublishedFactor> {
  const factor = await getDatabase().factor.findFirst({
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

  const report = await getDatabase().factorReport.findFirst({
    where: {
      id: approvedReportId,
      userId,
      factor: factorId,
      AND: [factorReportStatusWhere(['done'])],
    },
    select: {
      id: true,
      analysisKind: true,
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
    factor.analysisKind === 'macro_regime' ||
    isRetiredFactorReport(report) ||
    normalizeAnalysisKind(report.analysisKind) !== normalizeAnalysisKind(factor.analysisKind) ||
    factorLanguage(report.language) !== factorLanguage(factor.language) ||
    report.runtimeVersion !== factor.runtimeVersion
  ) {
    throw new FactorError('publication_report_invalid');
  }
  if (
    (factor.analysisKind === 'time_series' || factor.analysisKind === 'panel') &&
    (await assetFactorCodeIsInvalid(
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
  const updated = await getDatabase().$transaction(async (transaction) => {
    const retainedReport = await transaction.factorReport.findFirst({
      where: {
        id: report.id,
        userId,
        factor: factorId,
        factorCodeHash: currentHash,
        factorCodeSnapshot: factor.code,
        AND: [factorReportStatusWhere(['done'])],
      },
      select: { id: true },
    });
    if (!retainedReport) {
      throw new FactorError('publication_report_invalid');
    }

    return transaction.factor.updateMany({
      where: {
        id: factorId,
        userId,
        status: 'draft',
        code: factor.code,
        key: factor.key,
        name: factor.name,
        analysisKind: factor.analysisKind,
        language: factor.language,
        runtimeVersion: factor.runtimeVersion,
      },
      data: {
        status: 'published',
        approvedReportId: report.id,
        codeHash: currentHash,
        publishedAt,
        archivedAt: null,
      },
    });
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

async function assetFactorCodeIsInvalid(
  code: string,
  analysisKind: 'time_series' | 'panel',
  language: FactorLanguage,
): Promise<boolean> {
  try {
    const sandbox = await FactorSandbox.start({ language, analysisKind, code });
    try {
      return sandbox.metadata.inputs.some((input) => !isFactorV2FieldKey(input));
    } finally {
      sandbox.close();
    }
  } catch {
    return true;
  }
}

export async function archiveFactor(userId: string, factorId: string): Promise<PublishedFactor> {
  const archivedAt = new Date();
  const updated = await getDatabase().factor.updateMany({
    where: { id: factorId, userId, status: 'published' },
    data: { status: 'archived', archivedAt },
  });
  if (updated.count === 0) {
    throw new FactorError('factor_not_found');
  }
  const factor = await getDatabase().factor.findUniqueOrThrow({ where: { id: factorId } });
  return publishedFactorResource(factor);
}

/**
 * 将已发布因子的冻结来源和报告元数据转换为公开资源。
 *
 * Render a published factor's frozen source and report metadata.
 */
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
