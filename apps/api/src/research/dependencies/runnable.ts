import { prisma } from '../../infra/database/prisma.js';
import { researchCellDependencyIssues } from './cell-values.js';

export class ResearchCellDependencyBlockedError extends Error {
  public constructor(readonly cellIds: string[]) {
    super('Research Cells have unresolved deleted dependencies');
    this.name = 'ResearchCellDependencyBlockedError';
  }
}

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
    throw new ResearchCellDependencyBlockedError(blockedCellIds);
  }
}
