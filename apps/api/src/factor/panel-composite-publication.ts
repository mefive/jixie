import type { PublishedFactor } from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import { factorAnalysisSourceSnapshot } from './analysis-job.js';
import { BUILTIN_USER_ID } from './builtin-factors.js';
import { FactorPublicationError } from './publication.js';
import { resolvePanelFactorSource } from './panel-composite-source.js';
import { factorPanelCompositeDefinitionV2Schema, sha256 } from './report-spec.js';

export async function publishPanelComposite(
  userId: string,
  compositeId: string,
  approvedReportId: string,
): Promise<PublishedFactor> {
  const composite = await prisma.factorComposite.findFirst({
    where: { id: compositeId, userId },
  });
  if (!composite) {
    throw new FactorPublicationError('not_found');
  }
  if (composite.status !== 'draft') {
    throw new FactorPublicationError('not_draft');
  }
  const definition = factorPanelCompositeDefinitionV2Schema.safeParse(composite.definition);
  if (!definition.success || !composite.key || composite.key !== definition.data.key) {
    throw new FactorPublicationError('report_invalid');
  }

  const report = await prisma.factorReport.findFirst({
    where: { id: approvedReportId, userId, factor: compositeId, status: 'done' },
    select: {
      id: true,
      analysisKind: true,
      phase: true,
      revealedAt: true,
      factorCodeSnapshot: true,
      factorCodeHash: true,
    },
  });
  if (
    !report?.factorCodeSnapshot ||
    !report.factorCodeHash ||
    report.analysisKind !== 'panel' ||
    (report.phase === 'holdout' && !report.revealedAt)
  ) {
    throw new FactorPublicationError('report_invalid');
  }

  await assertPublishedComponents(
    userId,
    definition.data.components.map((item) => item.factor),
  );
  const source = await resolvePanelFactorSource(userId, compositeId);
  if (!source || source.kind !== 'panel_composite') {
    throw new FactorPublicationError('report_invalid');
  }
  const currentSnapshot = factorAnalysisSourceSnapshot(source);
  const currentHash = sha256(currentSnapshot);
  if (report.factorCodeSnapshot !== currentSnapshot || report.factorCodeHash !== currentHash) {
    throw new FactorPublicationError('report_outdated');
  }

  const publishedAt = new Date();
  const updated = await prisma.factorComposite.updateMany({
    where: { id: compositeId, userId, status: 'draft' },
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
    id: composite.id,
    key: composite.key,
    name: composite.name,
    analysisKind: 'panel',
    status: 'published',
    codeHash: currentHash,
    approvedReportId: report.id,
    publishedAt: publishedAt.toISOString(),
    archivedAt: null,
  };
}

export async function archivePanelComposite(
  userId: string,
  compositeId: string,
): Promise<PublishedFactor | null> {
  const archivedAt = new Date();
  const updated = await prisma.factorComposite.updateMany({
    where: { id: compositeId, userId, status: 'published' },
    data: { status: 'archived', visibility: 'private', archivedAt },
  });
  if (updated.count === 0) {
    return null;
  }
  const composite = await prisma.factorComposite.findUniqueOrThrow({ where: { id: compositeId } });
  if (!composite.key || !composite.codeHash || !composite.publishedAt) {
    throw new FactorPublicationError('not_draft');
  }
  return {
    id: composite.id,
    key: composite.key,
    name: composite.name,
    analysisKind: 'panel',
    status: 'archived',
    codeHash: composite.codeHash,
    approvedReportId: composite.approvedReportId,
    publishedAt: composite.publishedAt.toISOString(),
    archivedAt: archivedAt.toISOString(),
  };
}

async function assertPublishedComponents(userId: string, factorIds: string[]): Promise<void> {
  const rows = await prisma.factor.findMany({
    where: {
      id: { in: factorIds },
      userId: { in: [userId, BUILTIN_USER_ID] },
      status: 'published',
      analysisKind: 'panel',
    },
    select: { id: true },
  });
  const publishedIds = new Set(rows.map((row) => row.id));
  if (factorIds.some((factorId) => !publishedIds.has(factorId))) {
    throw new FactorPublicationError('report_invalid');
  }
}
