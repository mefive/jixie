import { prisma } from '../../infra/database/prisma.js';
import type { ResearchPythonAnalysis } from '../sdk/analysis-types.js';
import { jsonStringArray, researchCellDependencyIssues } from './cell-values.js';
import {
  researchDownstreamDependencyCellIds,
  type ResearchCellDependencyIssueV1,
} from '@jixie/shared';
import { researchDependencyCell, downstreamResearchCellIds } from './run-plan.js';
import type { Prisma } from '@prisma/client';

export interface ResearchCellChangeDependencySeed {
  cellId: string;
  previousDefinitions: string[];
}

export async function reconcileResearchCellChanges(
  documentId: string,
  seeds: ResearchCellChangeDependencySeed[],
): Promise<void> {
  const cells = await prisma.researchCell.findMany({
    where: { documentId, kind: 'python' },
    orderBy: { position: 'asc' },
    select: { id: true, definitions: true, references: true },
  });
  const analyses: ResearchPythonAnalysis[] = cells.map((cell) => ({
    cellId: cell.id,
    definitions: jsonStringArray(cell.definitions),
    references: jsonStringArray(cell.references),
  }));
  const analysisByCellId = new Map(analyses.map((analysis) => [analysis.cellId, analysis]));
  for (const seed of seeds) {
    const currentDefinitions = analysisByCellId.get(seed.cellId)?.definitions ?? [];
    await markDownstreamStale(
      documentId,
      seed.cellId,
      new Set([...seed.previousDefinitions, ...currentDefinitions]),
      analyses,
    );
  }
  await reconcileResearchCellDependencyIssues(documentId, analyses);
}

export function deletedDependencyDefinitionsByCellId(
  deletedCellId: string,
  deletedDefinitions: string[],
  analyses: ResearchPythonAnalysis[],
): Map<string, string[]> {
  const definitionsByCellId = new Map<string, string[]>();
  for (const definition of deletedDefinitions) {
    const downstreamCellIds = researchDownstreamDependencyCellIds(
      analyses.map(researchDependencyCell),
      [deletedCellId],
      [definition],
    );
    for (const downstreamCellId of downstreamCellIds) {
      definitionsByCellId.set(downstreamCellId, [
        ...(definitionsByCellId.get(downstreamCellId) ?? []),
        definition,
      ]);
    }
  }
  return definitionsByCellId;
}

export async function appendDeletedResearchCellDependencyIssues(
  documentId: string,
  issue: ResearchCellDependencyIssueV1,
  missingDefinitionsByCellId: Map<string, string[]>,
): Promise<void> {
  if (missingDefinitionsByCellId.size === 0) {
    return;
  }
  const cells = await prisma.researchCell.findMany({
    where: { documentId, id: { in: [...missingDefinitionsByCellId.keys()] } },
    select: { id: true, dependencyIssues: true },
  });
  const updates = cells.flatMap((cell) => {
    const missingDefinitions = missingDefinitionsByCellId.get(cell.id) ?? [];
    if (missingDefinitions.length === 0) {
      return [];
    }
    const dependencyIssues = [
      ...researchCellDependencyIssues(cell.dependencyIssues).filter(
        (candidate) => candidate.sourceCellId !== issue.sourceCellId,
      ),
      { ...issue, missingDefinitions },
    ];
    return [
      prisma.researchCell.update({
        where: { id: cell.id },
        data: {
          status: 'blocked',
          dependencyIssues: dependencyIssues as unknown as Prisma.InputJsonValue,
        },
      }),
    ];
  });
  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }
}

export async function reconcileResearchCellDependencyIssues(
  documentId: string,
  analyses: ResearchPythonAnalysis[],
): Promise<void> {
  const cells = await prisma.researchCell.findMany({
    where: { documentId },
    select: {
      id: true,
      status: true,
      dependencyIssues: true,
      lastExecutedRevision: true,
    },
  });
  const dependencyCells = analyses.map(researchDependencyCell);
  const issueFreeCellIds = new Set(
    cells
      .filter((cell) => researchCellDependencyIssues(cell.dependencyIssues).length === 0)
      .map((cell) => cell.id),
  );
  const availableDefinitions = new Set(
    analyses
      .filter((analysis) => issueFreeCellIds.has(analysis.cellId))
      .flatMap((analysis) => analysis.definitions),
  );
  const downstreamCellIdsByIssueDefinition = new Map<string, Set<string>>();
  const downstreamFor = (sourceCellId: string, definition: string): Set<string> => {
    const key = `${sourceCellId}\u0000${definition}`;
    const cached = downstreamCellIdsByIssueDefinition.get(key);
    if (cached) {
      return cached;
    }
    const downstream = new Set(
      researchDownstreamDependencyCellIds(dependencyCells, [sourceCellId], [definition]),
    );
    downstreamCellIdsByIssueDefinition.set(key, downstream);
    return downstream;
  };
  const updates = cells.flatMap((cell) => {
    const currentIssues = researchCellDependencyIssues(cell.dependencyIssues);
    const dependencyIssues = currentIssues.flatMap((issue) => {
      const missingDefinitions = issue.missingDefinitions.filter(
        (definition) =>
          !availableDefinitions.has(definition) &&
          downstreamFor(issue.sourceCellId, definition).has(cell.id),
      );
      return missingDefinitions.length > 0 ? [{ ...issue, missingDefinitions }] : [];
    });
    const status =
      dependencyIssues.length > 0
        ? 'blocked'
        : cell.status === 'blocked'
          ? cell.lastExecutedRevision == null
            ? 'idle'
            : 'stale'
          : cell.status;
    if (
      status === cell.status &&
      JSON.stringify(dependencyIssues) === JSON.stringify(currentIssues)
    ) {
      return [];
    }
    return [
      prisma.researchCell.update({
        where: { id: cell.id },
        data: {
          status,
          dependencyIssues: dependencyIssues as unknown as Prisma.InputJsonValue,
        },
      }),
    ];
  });
  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }
}

export async function markDownstreamStale(
  documentId: string,
  changedCellId: string,
  seedNames: Set<string>,
  analyses: ResearchPythonAnalysis[],
): Promise<void> {
  const stale = downstreamResearchCellIds(changedCellId, seedNames, analyses);
  if (stale.length === 0) {
    return;
  }
  await prisma.researchCell.updateMany({
    where: {
      documentId,
      id: { in: stale },
      status: { not: 'blocked' },
      lastExecutedRevision: { not: null },
    },
    data: { status: 'stale' },
  });
}
