import {
  type ResearchDependencyConflictV1,
  researchDownstreamDependencyCellIds,
} from '@jixie/shared';
import { ResearchError } from '../errors.js';
import type { ResearchPythonAnalysis } from '../sdk/analysis-types.js';

export interface ResearchAffectedRunPlan {
  cellIds: string[];
  dependenciesByCellId: Map<string, string[]>;
}

export function researchDependencyCell(analysis: ResearchPythonAnalysis) {
  return {
    id: analysis.cellId,
    definitions: analysis.definitions,
    references: analysis.references,
  };
}

export function downstreamResearchCellIds(
  changedCellId: string,
  seedNames: Set<string>,
  analyses: ResearchPythonAnalysis[],
): string[] {
  return researchDownstreamDependencyCellIds(
    analyses.map(researchDependencyCell),
    [changedCellId],
    [...seedNames],
  );
}

export function affectedResearchCellRunPlan(
  selectedCellIds: string | string[],
  analyses: ResearchPythonAnalysis[],
): ResearchAffectedRunPlan {
  const selected = Array.isArray(selectedCellIds) ? selectedCellIds : [selectedCellIds];
  const orderByCellId = new Map(analyses.map((analysis, index) => [analysis.cellId, index]));
  const availableSelectedCellIds = selected.filter((cellId) => orderByCellId.has(cellId));
  if (availableSelectedCellIds.length === 0) {
    return { cellIds: [], dependenciesByCellId: new Map() };
  }

  const definitionsByName = new Map<string, string[]>();
  for (const analysis of analyses) {
    for (const name of analysis.definitions) {
      definitionsByName.set(name, [...(definitionsByName.get(name) ?? []), analysis.cellId]);
    }
  }

  const dependenciesByCellId = new Map(
    analyses.map((analysis) => [analysis.cellId, new Set<string>()]),
  );
  const dependentsByCellId = new Map(
    analyses.map((analysis) => [analysis.cellId, new Set<string>()]),
  );
  for (const analysis of analyses) {
    for (const reference of analysis.references) {
      for (const providerCellId of definitionsByName.get(reference) ?? []) {
        if (providerCellId === analysis.cellId) {
          continue;
        }
        dependenciesByCellId.get(analysis.cellId)!.add(providerCellId);
        dependentsByCellId.get(providerCellId)!.add(analysis.cellId);
      }
    }
  }

  const affectedCellIds = new Set(availableSelectedCellIds);
  const pendingCellIds = [...availableSelectedCellIds];
  while (pendingCellIds.length > 0) {
    const pendingCellId = pendingCellIds.shift()!;
    for (const dependentCellId of dependentsByCellId.get(pendingCellId) ?? []) {
      if (!affectedCellIds.has(dependentCellId)) {
        affectedCellIds.add(dependentCellId);
        pendingCellIds.push(dependentCellId);
      }
    }
  }

  const conflicts = dependencyConflicts(analyses).filter((conflict) =>
    analyses.some(
      (analysis) =>
        affectedCellIds.has(analysis.cellId) &&
        (analysis.definitions.includes(conflict.name) ||
          analysis.references.includes(conflict.name)),
    ),
  );
  if (conflicts.length > 0) {
    throw new ResearchError('affected_duplicate_definitions', {
      details: { reason: 'duplicate_definitions', conflicts: conflicts },
    });
  }

  const affectedDependenciesByCellId = new Map<string, string[]>();
  const remainingDependencyCount = new Map<string, number>();
  for (const affectedCellId of affectedCellIds) {
    const dependencies = [...(dependenciesByCellId.get(affectedCellId) ?? [])].filter(
      (dependencyCellId) => affectedCellIds.has(dependencyCellId),
    );
    affectedDependenciesByCellId.set(affectedCellId, dependencies);
    remainingDependencyCount.set(affectedCellId, dependencies.length);
  }

  const readyCellIds = [...affectedCellIds]
    .filter((affectedCellId) => remainingDependencyCount.get(affectedCellId) === 0)
    .sort((left, right) => orderByCellId.get(left)! - orderByCellId.get(right)!);
  const orderedCellIds: string[] = [];
  while (readyCellIds.length > 0) {
    const readyCellId = readyCellIds.shift()!;
    orderedCellIds.push(readyCellId);
    for (const dependentCellId of dependentsByCellId.get(readyCellId) ?? []) {
      if (!affectedCellIds.has(dependentCellId)) {
        continue;
      }
      const remaining = remainingDependencyCount.get(dependentCellId)! - 1;
      remainingDependencyCount.set(dependentCellId, remaining);
      if (remaining === 0) {
        readyCellIds.push(dependentCellId);
        readyCellIds.sort((left, right) => orderByCellId.get(left)! - orderByCellId.get(right)!);
      }
    }
  }

  if (orderedCellIds.length !== affectedCellIds.size) {
    const cyclicCellIds = [...affectedCellIds]
      .filter((affectedCellId) => !orderedCellIds.includes(affectedCellId))
      .sort((left, right) => orderByCellId.get(left)! - orderByCellId.get(right)!);
    throw new ResearchError('affected_cyclic_dependency', {
      details: { reason: 'cyclic_dependency', cellIds: cyclicCellIds },
    });
  }

  return { cellIds: orderedCellIds, dependenciesByCellId: affectedDependenciesByCellId };
}

export function dependencyConflicts(
  analyses: ResearchPythonAnalysis[],
): ResearchDependencyConflictV1[] {
  const definitionsByName = new Map<string, string[]>();
  for (const analysis of analyses) {
    for (const name of analysis.definitions) {
      definitionsByName.set(name, [...(definitionsByName.get(name) ?? []), analysis.cellId]);
    }
  }
  return [...definitionsByName]
    .filter(([, cellIds]) => cellIds.length > 1)
    .map(([name, cellIds]) => ({ name, cellIds }));
}
