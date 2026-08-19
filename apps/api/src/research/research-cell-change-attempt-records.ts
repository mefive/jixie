import type { Prisma } from '@prisma/client';
import type {
  ResearchCellChangeAttemptCellV1,
  ResearchCellChangeAttemptComparisonV1,
  ResearchCellChangeAttemptScopeV1,
  ResearchCellChangeAttemptStatusV1,
  ResearchCellChangeAttemptV1,
  ResearchCellKindV1,
} from '@jixie/shared';
import { prisma } from '../lib/prisma.js';
import { researchPayloadHash } from './fingerprints.js';

export const researchCellChangeAttemptInclude = {
  executions: {
    orderBy: { startedAt: 'asc' },
    include: { cell: { select: { kind: true, position: true } } },
  },
} satisfies Prisma.ResearchCellChangeAttemptInclude;

export type ResearchCellChangeAttemptRow = Prisma.ResearchCellChangeAttemptGetPayload<{
  include: typeof researchCellChangeAttemptInclude;
}>;

export async function listResearchCellChangeAttempts(
  userId: string,
  documentId: string,
): Promise<ResearchCellChangeAttemptV1[]> {
  const attempts = await prisma.researchCellChangeAttempt.findMany({
    where: { documentId, document: { userId } },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: 20,
    include: researchCellChangeAttemptInclude,
  });
  return attempts.map((attempt, index) => {
    const previous = attempts
      .slice(index + 1)
      .find((candidate) => candidate.proposalId === attempt.proposalId);
    return researchCellChangeAttemptView(attempt, previous);
  });
}

export function researchCellChangeAttemptView(
  attempt: ResearchCellChangeAttemptRow,
  previous?: ResearchCellChangeAttemptRow,
): ResearchCellChangeAttemptV1 {
  const cells = attempt.executions.map(researchCellChangeAttemptCellView);
  const previousCells = previous?.executions.map(researchCellChangeAttemptCellView);
  return {
    version: 1,
    id: attempt.id,
    documentId: attempt.documentId,
    proposalId: attempt.proposalId,
    contentRevision: attempt.contentRevision,
    scope: attempt.scope as ResearchCellChangeAttemptScopeV1,
    rootCellIds: jsonStringArray(attempt.rootCellIds),
    plannedCellIds: jsonStringArray(attempt.plannedCellIds),
    status: attempt.status as ResearchCellChangeAttemptStatusV1,
    cells,
    ...(attempt.error ? { error: attempt.error } : {}),
    ...(attempt.explanationTurnId ? { explanationTurnId: attempt.explanationTurnId } : {}),
    ...(previous && previousCells
      ? { comparisonToPrevious: compareCellChangeAttempts(attempt, cells, previous, previousCells) }
      : {}),
    startedAt: attempt.startedAt.toISOString(),
    ...(attempt.finishedAt ? { finishedAt: attempt.finishedAt.toISOString() } : {}),
  };
}

function researchCellChangeAttemptCellView(
  execution: ResearchCellChangeAttemptRow['executions'][number],
): ResearchCellChangeAttemptCellV1 {
  const outputs = Array.isArray(execution.output) ? execution.output : [];
  return {
    executionId: execution.id,
    cellId: execution.sourceCellId ?? execution.cellId ?? '',
    position: execution.sourcePosition ?? execution.cell?.position ?? 0,
    kind: (execution.sourceKind ?? execution.cell?.kind ?? 'python') as ResearchCellKindV1,
    revision: execution.revision,
    status: execution.status as ResearchCellChangeAttemptCellV1['status'],
    sourceHash: researchPayloadHash(execution.source),
    ...(execution.output != null ? { outputHash: researchPayloadHash(execution.output) } : {}),
    outputTypes: outputs
      .map((output) =>
        output && typeof output === 'object' && 'type' in output ? String(output.type) : '',
      )
      .filter(Boolean) as ResearchCellChangeAttemptCellV1['outputTypes'],
    environmentFingerprint: execution.environmentFingerprint,
    ...(execution.error ? { error: execution.error } : {}),
  };
}

function compareCellChangeAttempts(
  attempt: ResearchCellChangeAttemptRow,
  cells: ResearchCellChangeAttemptCellV1[],
  previous: ResearchCellChangeAttemptRow,
  previousCells: ResearchCellChangeAttemptCellV1[],
): ResearchCellChangeAttemptComparisonV1 {
  const currentByCellId = new Map(cells.map((cell) => [cell.cellId, cell]));
  const previousByCellId = new Map(previousCells.map((cell) => [cell.cellId, cell]));
  const cellIds = new Set([...currentByCellId.keys(), ...previousByCellId.keys()]);
  const sourceChangedCellIds = [...cellIds].filter(
    (cellId) =>
      currentByCellId.get(cellId)?.sourceHash !== previousByCellId.get(cellId)?.sourceHash,
  );
  const outputChangedCellIds = [...cellIds].filter(
    (cellId) =>
      currentByCellId.get(cellId)?.outputHash !== previousByCellId.get(cellId)?.outputHash,
  );
  const environmentChanged = [...cellIds].some(
    (cellId) =>
      currentByCellId.get(cellId)?.environmentFingerprint !==
      previousByCellId.get(cellId)?.environmentFingerprint,
  );
  return {
    version: 1,
    previousAttemptId: previous.id,
    sourceChangedCellIds,
    outputChangedCellIds,
    statusChanged: attempt.status !== previous.status,
    environmentChanged,
  };
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
