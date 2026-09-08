import type { Prisma } from '@prisma/client';
import type { ResearchCellDependencyIssueV1 } from '@jixie/shared';

export function jsonStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function researchCellDependencyIssues(value: unknown): ResearchCellDependencyIssueV1[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }
    const issue = candidate as Record<string, unknown>;
    const sourceCellKind = issue.sourceCellKind;
    if (
      issue.version !== 1 ||
      issue.reason !== 'deleted_upstream_cell' ||
      typeof issue.sourceCellId !== 'string' ||
      typeof issue.sourceCellPosition !== 'number' ||
      (sourceCellKind !== 'markdown' && sourceCellKind !== 'python') ||
      !Array.isArray(issue.missingDefinitions)
    ) {
      return [];
    }
    const missingDefinitions = issue.missingDefinitions.filter(
      (definition): definition is string => typeof definition === 'string',
    );
    if (missingDefinitions.length === 0) {
      return [];
    }
    return [
      {
        version: 1 as const,
        reason: 'deleted_upstream_cell' as const,
        sourceCellId: issue.sourceCellId,
        sourceCellPosition: issue.sourceCellPosition,
        sourceCellKind,
        missingDefinitions,
      },
    ];
  });
}
