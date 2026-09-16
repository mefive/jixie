import type { ResearchAffectedRunPlan } from '../dependencies/run-plan.js';

export async function executeAffectedResearchCellPlan(
  plan: ResearchAffectedRunPlan,
  executeCellById: (cellId: string) => Promise<boolean>,
  shouldStop: () => boolean = () => false,
): Promise<string[]> {
  const blockedCellIds = new Set<string>();
  const executedCellIds: string[] = [];
  for (const cellId of plan.cellIds) {
    if (shouldStop()) {
      break;
    }
    const dependencies = plan.dependenciesByCellId.get(cellId) ?? [];
    if (dependencies.some((dependencyCellId) => blockedCellIds.has(dependencyCellId))) {
      blockedCellIds.add(cellId);
      continue;
    }

    const succeeded = await executeCellById(cellId);
    executedCellIds.push(cellId);
    if (!succeeded) {
      blockedCellIds.add(cellId);
    }
  }
  return executedCellIds;
}
