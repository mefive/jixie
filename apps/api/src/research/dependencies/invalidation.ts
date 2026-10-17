import { prisma } from '#infra/database/prisma.js';
import type { ResearchPythonAnalysis } from '../sandbox/host/analysis-types.js';
import { jsonStringArray, researchCellDependencyIssues } from './cell-values.js';
import {
  researchDownstreamDependencyCellIds,
  type ResearchCellDependencyIssueV1,
} from '@jixie/shared';
import { researchDependencyCell, downstreamResearchCellIds } from './run-plan.js';
import type { Prisma } from '@prisma/client';

/**
 * 保存修改前依赖状态，供变更后失效协调。
 *
 * Retain pre-change dependencies for post-edit invalidation.
 */
export interface ResearchCellChangeDependencySeed {
  cellId: string;
  previousDefinitions: string[];
}

/**
 * 根据 Cell 修改计算受影响下游，并更新依赖状态与输出有效性。
 *
 * Reconcile downstream dependency state and output validity after cell changes.
 */
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

/**
 * 从已删除 Cell 的定义建立下游缺失索引，供失效解释。
 *
 * Index definitions lost through deleted cells for downstream diagnostics.
 */
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

/**
 * 为引用已删除 Cell 的下游增加明确依赖问题。
 *
 * Attach dependency issues to downstream cells referencing deleted cells.
 */
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

/**
 * 根据静态分析结果协调缺失、冲突和依赖状态，供可运行性检查。
 *
 * Reconcile missing, conflicting and blocked dependencies from static analysis.
 */
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

  /**
   * 重算仍存在的缺失依赖问题并生成 Cell 更新集合。
   *
   * Recompute remaining missing-dependency issues and prepare cell updates.
   */
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
