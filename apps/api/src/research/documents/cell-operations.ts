import type { ResearchCellKindV1, ResearchDocumentV1 } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { assertNoOpenCellChangeReview } from '../proposals/review-state.js';
import { cellCreate } from './cell-seed.js';
import { analyzeAndPersist, analyzeResearchCellSources } from '../dependencies/analyze.js';
import { getResearchDocument } from './read.js';
import { ResearchCellRevisionConflictError } from './revision-errors.js';
import { jsonStringArray, researchCellDependencyIssues } from '../dependencies/cell-values.js';
import type { Prisma } from '@prisma/client';
import {
  markDownstreamStale,
  reconcileResearchCellDependencyIssues,
  deletedDependencyDefinitionsByCellId,
  appendDeletedResearchCellDependencyIssues,
} from '../dependencies/invalidation.js';

export async function addResearchCell(
  userId: string,
  documentId: string,
  kind: ResearchCellKindV1,
  source = '',
): Promise<ResearchDocumentV1 | null> {
  const document = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId },
    select: {
      id: true,
      cells: { select: { position: true }, orderBy: { position: 'desc' }, take: 1 },
    },
  });
  if (!document) {
    return null;
  }
  await assertNoOpenCellChangeReview(documentId);
  await prisma.$transaction([
    prisma.researchCell.create({
      data: {
        ...cellCreate({ kind, source }, (document.cells[0]?.position ?? -1) + 1),
        documentId,
      },
    }),
    prisma.researchDocument.update({
      where: { id: documentId },
      data: { updatedAt: new Date(), contentRevision: { increment: 1 } },
    }),
  ]);
  await analyzeAndPersist(documentId);
  return getResearchDocument(userId, documentId);
}

export async function updateResearchCell(
  userId: string,
  cellId: string,
  patch: { source?: string; config?: Record<string, unknown>; expectedRevision: number },
): Promise<ResearchDocumentV1 | null> {
  const cell = await prisma.researchCell.findFirst({
    where: { id: cellId, document: { userId } },
    select: {
      id: true,
      documentId: true,
      source: true,
      config: true,
      revision: true,
      definitions: true,
      dependencyIssues: true,
      lastExecutedRevision: true,
    },
  });
  if (!cell) {
    return null;
  }
  if (cell.revision !== patch.expectedRevision) {
    throw new ResearchCellRevisionConflictError({
      id: cell.id,
      source: cell.source,
      revision: cell.revision,
    });
  }
  const sourceChanged = patch.source !== undefined && patch.source !== cell.source;
  const configChanged =
    patch.config !== undefined && JSON.stringify(patch.config) !== JSON.stringify(cell.config);
  const contentChanged = sourceChanged || configChanged;
  if (!contentChanged) {
    return getResearchDocument(userId, cell.documentId);
  }
  const documentCells = await prisma.researchCell.findMany({
    where: { documentId: cell.documentId },
    select: {
      id: true,
      kind: true,
      source: true,
      definitions: true,
      references: true,
    },
    orderBy: { position: 'asc' },
  });
  const analyses = sourceChanged
    ? await analyzeResearchCellSources(
        cell.documentId,
        documentCells.map((candidate) => ({
          id: candidate.id,
          kind: candidate.kind,
          source:
            candidate.id === cell.id && patch.source !== undefined
              ? patch.source
              : candidate.source,
        })),
      )
    : documentCells.map((candidate) => ({
        cellId: candidate.id,
        definitions: jsonStringArray(candidate.definitions),
        references: jsonStringArray(candidate.references),
      }));
  await prisma.$transaction(async (transaction) => {
    const result = await transaction.researchCell.updateMany({
      where: { id: cell.id, revision: patch.expectedRevision },
      data: {
        ...(patch.source !== undefined ? { source: patch.source } : {}),
        ...(patch.config !== undefined
          ? { config: patch.config as unknown as Prisma.InputJsonValue }
          : {}),
        revision: { increment: 1 },
        status:
          researchCellDependencyIssues(cell.dependencyIssues).length > 0
            ? 'blocked'
            : cell.lastExecutedRevision == null
              ? 'idle'
              : 'stale',
      },
    });
    if (result.count === 0) {
      const current = await transaction.researchCell.findUnique({
        where: { id: cell.id },
        select: { id: true, source: true, revision: true },
      });
      if (!current) {
        throw new ResearchCellRevisionConflictError({
          id: cell.id,
          source: cell.source,
          revision: cell.revision,
        });
      }
      throw new ResearchCellRevisionConflictError(current);
    }
    if (sourceChanged) {
      const analysis = analyses.find((candidate) => candidate.cellId === cell.id);
      await transaction.researchCell.update({
        where: { id: cell.id },
        data: {
          definitions: (analysis?.definitions ?? []) as unknown as Prisma.InputJsonValue,
          references: (analysis?.references ?? []) as unknown as Prisma.InputJsonValue,
        },
      });
    }
    await transaction.researchDocument.update({
      where: { id: cell.documentId },
      data: { updatedAt: new Date(), contentRevision: { increment: 1 } },
    });
  });
  if (contentChanged) {
    const oldDefinitions = jsonStringArray(cell.definitions);
    const current = analyses.find((analysis) => analysis.cellId === cell.id);
    const seedNames = new Set([...oldDefinitions, ...(current?.definitions ?? [])]);
    await markDownstreamStale(cell.documentId, cell.id, seedNames, analyses);
    await reconcileResearchCellDependencyIssues(cell.documentId, analyses);
  }
  return getResearchDocument(userId, cell.documentId);
}

export async function deleteResearchCell(
  userId: string,
  cellId: string,
): Promise<ResearchDocumentV1 | null> {
  const cell = await prisma.researchCell.findFirst({
    where: { id: cellId, document: { userId } },
    select: {
      id: true,
      documentId: true,
      position: true,
      kind: true,
      definitions: true,
    },
  });
  if (!cell) {
    return null;
  }
  await assertNoOpenCellChangeReview(cell.documentId);
  const beforeAnalyses = await analyzeAndPersist(cell.documentId);
  const currentDefinitions = beforeAnalyses.find(
    (analysis) => analysis.cellId === cell.id,
  )?.definitions;
  const deletedDefinitions = [
    ...new Set([...(currentDefinitions ?? []), ...jsonStringArray(cell.definitions)]),
  ];
  const missingDefinitionsByCellId = deletedDependencyDefinitionsByCellId(
    cell.id,
    deletedDefinitions,
    beforeAnalyses,
  );

  await prisma.researchCell.delete({ where: { id: cell.id } });
  const analyses = await analyzeAndPersist(cell.documentId);
  await appendDeletedResearchCellDependencyIssues(
    cell.documentId,
    {
      version: 1,
      reason: 'deleted_upstream_cell',
      sourceCellId: cell.id,
      sourceCellPosition: cell.position,
      sourceCellKind: cell.kind as ResearchCellKindV1,
      missingDefinitions: deletedDefinitions,
    },
    missingDefinitionsByCellId,
  );
  await reconcileResearchCellDependencyIssues(cell.documentId, analyses);
  await prisma.researchDocument.update({
    where: { id: cell.documentId },
    data: { updatedAt: new Date(), contentRevision: { increment: 1 } },
  });
  return getResearchDocument(userId, cell.documentId);
}
