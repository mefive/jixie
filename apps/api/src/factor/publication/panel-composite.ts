import { factorReportStatusWhere } from '#factor/evaluations/state.js';
import { getDatabase } from '#infra/database/prisma.js';
import type { PublishedFactor } from '@jixie/shared';
import { resolvePanelFactorSource } from '../composition/panel-source.js';
import { BUILTIN_USER_ID } from '../definitions/builtin-factors.js';
import { FactorError } from '../errors.js';
import { factorPanelCompositeDefinitionV2Schema } from '@jixie/shared/api/factor';
import { sha256 } from '../sources/fingerprint.js';
import { factorAnalysisSourceSnapshot } from '../sources/snapshot.js';

/**
 * 验证 Panel 组合的组件与准入证据后发布冻结版本。
 *
 * Publish a frozen panel composite after validating components and admission evidence.
 */
export async function publishPanelComposite(
  userId: string,
  compositeId: string,
  approvedReportId: string,
): Promise<PublishedFactor> {
  const composite = await getDatabase().factorComposite.findFirst({
    where: { id: compositeId, userId },
  });
  if (!composite) {
    throw new FactorError('publication_not_found');
  }
  if (composite.status !== 'draft') {
    throw new FactorError('publication_not_draft');
  }
  const definition = factorPanelCompositeDefinitionV2Schema.safeParse(composite.definition);
  if (!definition.success || !composite.key || composite.key !== definition.data.key) {
    throw new FactorError('publication_report_invalid');
  }

  const report = await getDatabase().factorReport.findFirst({
    where: {
      id: approvedReportId,
      userId,
      factor: compositeId,
      AND: [factorReportStatusWhere(['done'])],
    },
    select: {
      id: true,
      analysisKind: true,
      factorCodeSnapshot: true,
      factorCodeHash: true,
    },
  });
  if (!report?.factorCodeSnapshot || !report.factorCodeHash || report.analysisKind !== 'panel') {
    throw new FactorError('publication_report_invalid');
  }

  await assertPublishedComponents(
    userId,
    definition.data.components.map((item) => item.factor),
  );
  const source = await resolvePanelFactorSource(userId, compositeId);
  if (!source || source.kind !== 'panel_composite') {
    throw new FactorError('publication_report_invalid');
  }
  const currentSnapshot = factorAnalysisSourceSnapshot(source);
  const currentHash = sha256(currentSnapshot);
  if (report.factorCodeSnapshot !== currentSnapshot || report.factorCodeHash !== currentHash) {
    throw new FactorError('publication_report_outdated');
  }

  const publishedAt = new Date();
  const updated = await getDatabase().factorComposite.updateMany({
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
    throw new FactorError('publication_not_draft');
  }

  return {
    id: composite.id,
    key: composite.key,
    name: composite.name,
    analysisKind: 'panel',
    language: 'typescript',
    runtimeVersion: 'ts-v1',
    status: 'published',
    codeHash: currentHash,
    approvedReportId: report.id,
    publishedAt: publishedAt.toISOString(),
    archivedAt: null,
  };
}

/**
 * 归档 Panel 组合并维护依赖引用约束。
 *
 * Archive a panel composite while respecting dependency constraints.
 */
export async function archivePanelComposite(
  userId: string,
  compositeId: string,
): Promise<PublishedFactor> {
  const archivedAt = new Date();
  const updated = await getDatabase().factorComposite.updateMany({
    where: { id: compositeId, userId, status: 'published' },
    data: { status: 'archived', archivedAt },
  });
  if (updated.count === 0) {
    throw new FactorError('factor_not_found');
  }
  const composite = await getDatabase().factorComposite.findUniqueOrThrow({
    where: { id: compositeId },
  });
  if (!composite.key || !composite.codeHash || !composite.publishedAt) {
    throw new FactorError('publication_not_draft');
  }
  return {
    id: composite.id,
    key: composite.key,
    name: composite.name,
    analysisKind: 'panel',
    language: 'typescript',
    runtimeVersion: 'ts-v1',
    status: 'archived',
    codeHash: composite.codeHash,
    approvedReportId: composite.approvedReportId,
    publishedAt: composite.publishedAt.toISOString(),
    archivedAt: archivedAt.toISOString(),
  };
}

async function assertPublishedComponents(userId: string, factorIds: string[]): Promise<void> {
  const rows = await getDatabase().factor.findMany({
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
    throw new FactorError('publication_report_invalid');
  }
}
