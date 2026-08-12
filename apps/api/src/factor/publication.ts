import type { FactorAnalysisKind, PublishedFactor } from '@jixie/shared';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { factorResearchSpecV1Schema, sha256 } from './report-spec.js';
import { compilePanelFactor, compileTimeSeriesFactor } from './compile-time-series-factor.js';
import { isResearchOnlyFactorV2Field } from './factor-v2-fields.js';

export const publishFactorBodySchema = z.object({
  approvedReportId: z.string().trim().min(1).max(80),
});

export type FactorPublicationErrorReason =
  | 'not_found'
  | 'not_draft'
  | 'report_invalid'
  | 'report_outdated';

export class FactorPublicationError extends Error {
  constructor(readonly reason: FactorPublicationErrorReason) {
    super(reason);
    this.name = 'FactorPublicationError';
  }
}

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
      status: true,
    },
  });
  if (!factor) {
    throw new FactorPublicationError('not_found');
  }
  if (factor.status !== 'draft') {
    throw new FactorPublicationError('not_draft');
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
      specJson: true,
      payload: true,
    },
  });
  if (
    !report?.factorCodeSnapshot ||
    !report.factorCodeHash ||
    (report.phase === 'holdout' && !report.revealedAt) ||
    normalizeAnalysisKind(report.analysisKind) !== normalizeAnalysisKind(factor.analysisKind)
  ) {
    throw new FactorPublicationError('report_invalid');
  }
  if (factor.analysisKind === 'macro_regime' && !macroReportIsPointInTime(report)) {
    throw new FactorPublicationError('report_invalid');
  }
  if (
    (factor.analysisKind === 'time_series' || factor.analysisKind === 'panel') &&
    (await assetFactorCodeUsesResearchOnlyInput(factor.code, factor.analysisKind))
  ) {
    throw new FactorPublicationError('report_invalid');
  }

  const currentHash = sha256(factor.code);
  if (report.factorCodeSnapshot !== factor.code || report.factorCodeHash !== currentHash) {
    throw new FactorPublicationError('report_outdated');
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
    throw new FactorPublicationError('not_draft');
  }

  return {
    id: factor.id,
    key: factor.key,
    name: factor.name,
    analysisKind: normalizeAnalysisKind(factor.analysisKind),
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
): Promise<boolean> {
  try {
    const compiled =
      analysisKind === 'time_series'
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

export async function archiveFactor(
  userId: string,
  factorId: string,
): Promise<PublishedFactor | null> {
  const archivedAt = new Date();
  const updated = await prisma.factor.updateMany({
    where: { id: factorId, userId, status: 'published' },
    data: { status: 'archived', visibility: 'private', archivedAt },
  });
  if (updated.count === 0) {
    return null;
  }
  const factor = await prisma.factor.findUniqueOrThrow({ where: { id: factorId } });
  return publishedFactorResource(factor);
}

export function normalizeAnalysisKind(value: string): FactorAnalysisKind {
  switch (value) {
    case 'time_series':
    case 'panel':
    case 'macro_regime':
      return value;
    default:
      return 'cross_sectional';
  }
}

function publishedFactorResource(row: {
  id: string;
  key: string;
  name: string;
  analysisKind: string;
  status: string;
  codeHash: string | null;
  approvedReportId: string | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
}): PublishedFactor {
  if (!row.codeHash || !row.publishedAt) {
    throw new FactorPublicationError('not_draft');
  }
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    analysisKind: normalizeAnalysisKind(row.analysisKind),
    status: row.status === 'archived' ? 'archived' : 'published',
    codeHash: row.codeHash,
    approvedReportId: row.approvedReportId,
    publishedAt: row.publishedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}
