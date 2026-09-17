import { prisma } from '#infra/database/prisma.js';
import { ResearchError } from '../errors.js';
import { researchCellDependencyIssues } from './cell-values.js';

export async function assertResearchCellIdsRunnable(
  documentId: string,
  cellIds: string[],
): Promise<void> {
  const cells = await prisma.researchCell.findMany({
    where: { documentId, id: { in: cellIds } },
    select: { id: true, dependencyIssues: true },
  });
  assertResearchCellsRunnable(cells);
}

export function assertResearchCellsRunnable(
  cells: Array<{ id: string; dependencyIssues: unknown }>,
): void {
  const blockedCellIds = cells
    .filter((cell) => researchCellDependencyIssues(cell.dependencyIssues).length > 0)
    .map((cell) => cell.id);
  if (blockedCellIds.length > 0) {
    throw new ResearchError('dependency_blocked', { details: { cellIds: blockedCellIds } });
  }
}
