import type { Prisma, ResearchCellExecution, ResearchExecution } from '@prisma/client';
import type {
  ResearchCellKindV1,
  ResearchCellOutputBlockV1,
  ResearchExecutionCellV1,
  ResearchExecutionDagNodeV1,
  ResearchExecutionPromotionInputV1,
  ResearchExecutionStatusV1,
  ResearchExecutionSummaryV1,
  ResearchExecutionV1,
} from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '../lib/prisma.js';
import { researchPayloadHash } from './fingerprints.js';

export interface ResearchExecutionSourceCellSnapshot {
  id: string;
  position: number;
  kind: ResearchCellKindV1;
  source: string;
  config?: Record<string, unknown>;
  revision: number;
  definitions: string[];
  references: string[];
}

interface ResearchExecutionSourceSnapshot {
  version: 1;
  cells: ResearchExecutionSourceCellSnapshot[];
}

interface ResearchExecutionDagSnapshot {
  version: 1;
  nodes: ResearchExecutionDagNodeV1[];
}

type ResearchExecutionWithCells = Prisma.ResearchExecutionGetPayload<{
  include: { cellExecutions: true };
}>;

export class ResearchExecutionPromotionUnavailableError extends Error {
  public constructor() {
    super('Only a successful Research Execution can be promoted');
    this.name = 'ResearchExecutionPromotionUnavailableError';
  }
}

export async function createResearchExecution(args: {
  documentId: string;
  title: string;
  contentRevision: number;
  runtimeVersion: string;
  cells: ResearchExecutionSourceCellSnapshot[];
}): Promise<ResearchExecution> {
  const sourceSnapshot: ResearchExecutionSourceSnapshot = { version: 1, cells: args.cells };
  const dagSnapshot: ResearchExecutionDagSnapshot = {
    version: 1,
    nodes: researchExecutionDag(args.cells),
  };
  const sourceHash = researchPayloadHash({
    title: args.title,
    contentRevision: args.contentRevision,
    runtimeVersion: args.runtimeVersion,
    sourceSnapshot,
    dagSnapshot,
  });

  return prisma.$transaction(async (transaction) => {
    const latest = await transaction.researchExecution.findFirst({
      where: { documentId: args.documentId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });
    return transaction.researchExecution.create({
      data: {
        id: ulid(),
        documentId: args.documentId,
        sequence: (latest?.sequence ?? 0) + 1,
        title: args.title,
        contentRevision: args.contentRevision,
        runtimeVersion: args.runtimeVersion,
        sourceHash,
        sourceSnapshot: sourceSnapshot as unknown as Prisma.InputJsonValue,
        dagSnapshot: dagSnapshot as unknown as Prisma.InputJsonValue,
        executedCellIds: [] as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

export async function finishResearchExecution(args: {
  executionId: string;
  status: Exclude<ResearchExecutionStatusV1, 'running'>;
  executedCellIds: string[];
  error?: string;
}): Promise<ResearchExecutionSummaryV1> {
  const cellExecutions = await prisma.researchCellExecution.findMany({
    where: { researchExecutionId: args.executionId },
    orderBy: { startedAt: 'asc' },
    select: {
      cellId: true,
      sourceCellId: true,
      revision: true,
      status: true,
      error: true,
      environmentFingerprint: true,
    },
  });
  const environmentFingerprint = researchPayloadHash({
    version: 1,
    cells: cellExecutions.map((execution) => ({
      cellId: execution.sourceCellId ?? execution.cellId,
      revision: execution.revision,
      status: execution.status,
      environmentFingerprint: execution.environmentFingerprint,
    })),
  });
  const execution = await prisma.researchExecution.update({
    where: { id: args.executionId },
    data: {
      status: args.status,
      executedCellIds: args.executedCellIds as unknown as Prisma.InputJsonValue,
      environmentFingerprint,
      error:
        (
          args.error ??
          cellExecutions.find((cellExecution) => cellExecution.status === 'error')?.error
        )?.slice(0, 8_000) ?? null,
      finishedAt: new Date(),
    },
  });
  return researchExecutionSummaryView(execution);
}

export async function listResearchExecutions(
  userId: string,
  documentId: string,
): Promise<ResearchExecutionSummaryV1[] | null> {
  const document = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId },
    select: { id: true },
  });
  if (!document) {
    return null;
  }
  const executions = await prisma.researchExecution.findMany({
    where: { documentId },
    orderBy: { sequence: 'desc' },
  });
  return executions.map(researchExecutionSummaryView);
}

export async function getResearchExecution(
  userId: string,
  executionId: string,
): Promise<ResearchExecutionV1 | null> {
  const execution = await prisma.researchExecution.findFirst({
    where: { id: executionId, document: { userId } },
    include: { cellExecutions: { orderBy: { startedAt: 'asc' } } },
  });
  return execution ? researchExecutionView(execution) : null;
}

export async function promoteResearchExecution(
  userId: string,
  executionId: string,
  input: ResearchExecutionPromotionInputV1,
): Promise<ResearchExecutionSummaryV1 | null> {
  const execution = await prisma.researchExecution.findFirst({
    where: { id: executionId, document: { userId } },
  });
  if (!execution) {
    return null;
  }
  if (execution.status !== 'success') {
    throw new ResearchExecutionPromotionUnavailableError();
  }
  const updated = await prisma.researchExecution.update({
    where: { id: execution.id },
    data: {
      displayName: input.displayName.trim(),
      tags: input.tags as unknown as Prisma.InputJsonValue,
      userNote: input.userNote?.trim() || null,
      promotedAt: execution.promotedAt ?? new Date(),
    },
  });
  return researchExecutionSummaryView(updated);
}

export function researchExecutionDag(
  cells: ResearchExecutionSourceCellSnapshot[],
): ResearchExecutionDagNodeV1[] {
  const definitionsByName = new Map<string, string[]>();
  for (const cell of cells) {
    for (const definition of cell.definitions) {
      definitionsByName.set(definition, [...(definitionsByName.get(definition) ?? []), cell.id]);
    }
  }

  return cells.map((cell) => {
    const dependencies = new Set<string>();
    for (const reference of cell.references) {
      for (const providerCellId of definitionsByName.get(reference) ?? []) {
        if (providerCellId !== cell.id) {
          dependencies.add(providerCellId);
        }
      }
    }
    return { cellId: cell.id, dependsOnCellIds: [...dependencies] };
  });
}

function researchExecutionView(execution: ResearchExecutionWithCells): ResearchExecutionV1 {
  const sourceSnapshot = execution.sourceSnapshot as unknown as ResearchExecutionSourceSnapshot;
  const dagSnapshot = execution.dagSnapshot as unknown as ResearchExecutionDagSnapshot;
  const executionByCellId = new Map(
    execution.cellExecutions.flatMap((cellExecution) => {
      const cellId = cellExecution.sourceCellId ?? cellExecution.cellId;
      return cellId ? [[cellId, cellExecution] as const] : [];
    }),
  );
  return {
    ...researchExecutionSummaryView(execution),
    cells: sourceSnapshot.cells.map((cell) =>
      researchExecutionCellView(cell, executionByCellId.get(cell.id)),
    ),
    dag: dagSnapshot.nodes,
  };
}

function researchExecutionSummaryView(execution: ResearchExecution): ResearchExecutionSummaryV1 {
  const sourceSnapshot = execution.sourceSnapshot as unknown as ResearchExecutionSourceSnapshot;
  const executedCellIds = jsonStringArray(execution.executedCellIds);
  return {
    version: 1,
    id: execution.id,
    documentId: execution.documentId,
    sequence: execution.sequence,
    title: execution.title,
    contentRevision: execution.contentRevision,
    runtimeVersion: 'research-py-v1',
    status: execution.status as ResearchExecutionStatusV1,
    sourceHash: execution.sourceHash,
    ...(execution.environmentFingerprint
      ? { environmentFingerprint: execution.environmentFingerprint }
      : {}),
    cellCount: sourceSnapshot.cells.length,
    executedCellCount: executedCellIds.length,
    ...(execution.error ? { error: execution.error } : {}),
    ...(execution.displayName ? { displayName: execution.displayName } : {}),
    tags: jsonStringArray(execution.tags),
    ...(execution.userNote ? { userNote: execution.userNote } : {}),
    ...(execution.promotedAt ? { promotedAt: execution.promotedAt.toISOString() } : {}),
    startedAt: execution.startedAt.toISOString(),
    ...(execution.finishedAt ? { finishedAt: execution.finishedAt.toISOString() } : {}),
  };
}

function researchExecutionCellView(
  snapshot: ResearchExecutionSourceCellSnapshot,
  execution?: ResearchCellExecution,
): ResearchExecutionCellV1 {
  return {
    version: 1,
    cellId: snapshot.id,
    position: snapshot.position,
    kind: snapshot.kind,
    source: snapshot.source,
    ...(snapshot.config ? { config: snapshot.config } : {}),
    revision: snapshot.revision,
    definitions: snapshot.definitions,
    references: snapshot.references,
    status: execution ? (execution.status as ResearchExecutionStatusV1) : ('not_run' as const),
    outputs: Array.isArray(execution?.output)
      ? (execution.output as unknown as ResearchCellOutputBlockV1[])
      : [],
    ...(execution?.error ? { error: execution.error } : {}),
    ...(execution?.environmentFingerprint && execution.environmentFingerprint !== 'pending'
      ? { environmentFingerprint: execution.environmentFingerprint }
      : {}),
    ...(execution ? { startedAt: execution.startedAt.toISOString() } : {}),
    ...(execution?.finishedAt ? { finishedAt: execution.finishedAt.toISOString() } : {}),
  };
}

function jsonStringArray(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
