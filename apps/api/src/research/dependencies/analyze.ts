import { researchRuntimePool } from '../runtime/pool.js';
import { prisma } from '#infra/database/prisma.js';
import type { ResearchDocumentAnalysisV1 } from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { ResearchError } from '../errors.js';

import type { ResearchPythonAnalysis } from '../runtime/host/analysis-types.js';
import { reconcileResearchCellDependencyIssues } from './invalidation.js';
import { dependencyConflicts } from './run-plan.js';

export async function analyzeResearchDocument(
  userId: string,
  documentId: string,
): Promise<ResearchDocumentAnalysisV1> {
  const owner = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId, embeddedVersion: null },
    select: { id: true },
  });
  if (!owner) {
    throw new ResearchError('document_not_found');
  }
  const cells = await analyzeAndPersist(documentId);
  return { version: 1, cells, conflicts: dependencyConflicts(cells) };
}

export async function analyzeAndPersist(documentId: string): Promise<ResearchPythonAnalysis[]> {
  const cells = await prisma.researchCell.findMany({
    where: { documentId },
    select: { id: true, kind: true, source: true },
    orderBy: { position: 'asc' },
  });
  const analyses = await analyzeResearchCellSources(documentId, cells);
  await prisma.$transaction(
    analyses.map((analysis) =>
      prisma.researchCell.update({
        where: { id: analysis.cellId },
        data: {
          definitions: analysis.definitions as unknown as Prisma.InputJsonValue,
          references: analysis.references as unknown as Prisma.InputJsonValue,
        },
      }),
    ),
  );
  await reconcileResearchCellDependencyIssues(documentId, analyses);
  return analyses;
}

export async function analyzeResearchCellSources(
  documentId: string,
  cells: Array<{ id: string; kind: string; source: string }>,
): Promise<ResearchPythonAnalysis[]> {
  const pythonCells = cells.filter((cell) => cell.kind === 'python');
  const pythonAnalyses =
    pythonCells.length > 0
      ? await researchRuntimePool.withRuntime(documentId, (runtime) => runtime.analyze(pythonCells))
      : [];
  const analysisById = new Map(pythonAnalyses.map((analysis) => [analysis.cellId, analysis]));
  const analyses = cells.map(
    (cell): ResearchPythonAnalysis =>
      analysisById.get(cell.id) ?? { cellId: cell.id, definitions: [], references: [] },
  );
  return analyses;
}
