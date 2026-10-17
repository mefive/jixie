import type { ResearchAffectedRunPlan } from '../dependencies/run-plan.js';

/**
 * 按已验证顺序执行受影响 Cell，遇到错误或中断保留已完成证据。
 *
 * Execute a validated affected-cell plan and retain completed evidence on failure or interruption.
 */
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
