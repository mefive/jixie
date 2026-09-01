import type { Prisma } from '@prisma/client';
import type {
  ChatMessage,
  ResearchCellKindV1,
  ResearchCellOutputBlockV1,
  ResearchCellV1,
  ResearchDependencyConflictV1,
  ResearchDocumentAnalysisV1,
  ResearchDocumentInterruptResultV1,
  ResearchDocumentListStateV1,
  ResearchDocumentRunResultV1,
  ResearchDocumentSummaryV1,
  ResearchDocumentTemplateV1,
  ResearchDocumentV1,
  ResearchExecutionSummaryV1,
} from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '../lib/prisma.js';
import { researchPayloadHash } from './fingerprints.js';
import {
  createResearchExecution,
  finishResearchExecution,
  type ResearchExecutionSourceCellSnapshot,
} from './research-execution-records.js';
import { listResearchCellChangeAttempts } from './research-cell-change-attempt-records.js';
import { researchCellChangeReviewView } from './research-cell-change-records.js';
import { materializeResearchOutputArtifacts } from './workbench-artifacts.js';
import {
  ResearchPythonExecutionError,
  ResearchPythonInterruptionError,
  researchRuntimeManager,
  type ResearchPythonAnalysis,
} from './workbench-runtime.js';

type ResearchDocumentRow = Prisma.ResearchDocumentGetPayload<{
  include: {
    conversation: {
      include: { messages: true };
    };
    cells: true;
    cellChangeProposals: true;
  };
}>;

interface ExecutableResearchCellRow {
  id: string;
  documentId: string;
  position: number;
  kind: string;
  source: string;
  config: Prisma.JsonValue | null;
  revision: number;
  definitions: Prisma.JsonValue;
  references: Prisma.JsonValue;
  lastExecutedRevision: number | null;
  document: {
    conversationId: string;
    conversation: { title: string | null; userId: string };
  };
}

interface CellSeed {
  kind: ResearchCellKindV1;
  source: string;
  config?: Record<string, unknown>;
}

export type ResearchAffectedRunErrorReason = 'duplicate_definitions' | 'cyclic_dependency';

export class ResearchAffectedRunError extends Error {
  public constructor(
    readonly reason: ResearchAffectedRunErrorReason,
    readonly details: ResearchDependencyConflictV1[] | string[],
  ) {
    super(reason);
    this.name = 'ResearchAffectedRunError';
  }
}

export interface ResearchAffectedRunPlan {
  cellIds: string[];
  dependenciesByCellId: Map<string, string[]>;
}

interface ResearchDocumentRunControl {
  documentId: string;
  interrupted: boolean;
  settled: Promise<void>;
  settle: () => void;
}

type ResearchCellExecutionOutcome = 'success' | 'error' | 'interrupted';

const activeResearchDocumentRuns = new Map<string, ResearchDocumentRunControl>();

export interface ResearchCellChangeDependencySeed {
  cellId: string;
  previousDefinitions: string[];
}

export class ResearchDocumentRunInProgressError extends Error {
  public constructor() {
    super('Research document already has an active run');
    this.name = 'ResearchDocumentRunInProgressError';
  }
}

export class ResearchCellChangeReviewOpenError extends Error {
  public constructor() {
    super('Research document has an open Agent change review');
    this.name = 'ResearchCellChangeReviewOpenError';
  }
}

export class ResearchCellRevisionConflictError extends Error {
  public constructor(readonly currentCell: { id: string; source: string; revision: number }) {
    super('Research Cell revision changed');
    this.name = 'ResearchCellRevisionConflictError';
  }
}

export class ResearchDocumentContentRevisionConflictError extends Error {
  public constructor(readonly currentContentRevision: number) {
    super('Research document content revision changed during execution');
    this.name = 'ResearchDocumentContentRevisionConflictError';
  }
}

export function isResearchDocumentRunActive(documentId: string): boolean {
  return activeResearchDocumentRuns.has(documentId);
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
}

export async function listResearchDocuments(
  userId: string,
  state: ResearchDocumentListStateV1 = 'active',
): Promise<ResearchDocumentSummaryV1[]> {
  const conversations = await prisma.agentConversation.findMany({
    where: {
      userId,
      surface: 'research',
      archivedAt: state === 'archived' ? { not: null } : null,
    },
    include: {
      researchDocument: {
        select: { cells: { select: { status: true } } },
      },
      messages: {
        orderBy: { sequence: 'desc' },
        take: 1,
        select: { parts: true },
      },
    },
    orderBy: state === 'archived' ? { archivedAt: 'desc' } : { updatedAt: 'desc' },
  });
  return conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title ?? '',
    preview: messagePreview(conversation.messages[0]?.parts),
    cellCount: conversation.researchDocument?.cells.length ?? 0,
    staleCount:
      conversation.researchDocument?.cells.filter((cell) => cell.status === 'stale').length ?? 0,
    archivedAt: conversation.archivedAt?.toISOString() ?? null,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  }));
}

export async function archiveResearchDocument(
  userId: string,
  documentId: string,
): Promise<boolean> {
  const conversation = await prisma.agentConversation.findFirst({
    where: { id: documentId, userId, surface: 'research' },
    select: { id: true, archivedAt: true },
  });
  if (!conversation) {
    return false;
  }
  if (!conversation.archivedAt) {
    await prisma.agentConversation.update({
      where: { id: conversation.id },
      data: { archivedAt: new Date() },
    });
  }
  closeResearchDocumentRuntime(documentId);
  return true;
}

export async function restoreResearchDocument(
  userId: string,
  documentId: string,
): Promise<boolean> {
  const conversation = await prisma.agentConversation.findFirst({
    where: { id: documentId, userId, surface: 'research' },
    select: { id: true, archivedAt: true },
  });
  if (!conversation) {
    return false;
  }
  if (conversation.archivedAt) {
    await prisma.agentConversation.update({
      where: { id: conversation.id },
      data: { archivedAt: null },
    });
  }
  return true;
}

export async function createResearchDocument(
  userId: string,
  template: ResearchDocumentTemplateV1,
): Promise<ResearchDocumentV1> {
  const id = ulid();
  const definition = templateDefinition(template);
  await prisma.$transaction(async (transaction) => {
    await transaction.agentConversation.create({
      data: { id, userId, surface: 'research', title: definition.title },
    });
    await transaction.researchDocument.create({
      data: {
        id,
        userId,
        conversationId: id,
        cells: {
          create: definition.cells.map((cell, position) => cellCreate(cell, position)),
        },
      },
    });
  });
  return (await getResearchDocument(userId, id))!;
}

export async function getResearchDocument(
  userId: string,
  documentId: string,
): Promise<ResearchDocumentV1 | null> {
  const owner = await prisma.agentConversation.findFirst({
    where: { id: documentId, userId, surface: 'research', archivedAt: null },
    select: { id: true, title: true, researchDocument: { select: { id: true } } },
  });
  if (!owner) {
    return null;
  }
  if (!owner.researchDocument) {
    const definition = legacyDefinition(owner.title ?? '');
    await prisma.researchDocument.create({
      data: {
        id: owner.id,
        userId,
        conversationId: owner.id,
        cells: { create: definition.cells.map((cell, position) => cellCreate(cell, position)) },
      },
    });
  }
  const document = await loadDocumentRow(userId, documentId);
  if (!document) {
    return null;
  }
  return {
    ...documentView(document),
    cellChangeAttempts: await listResearchCellChangeAttempts(userId, documentId),
  };
}

export async function addResearchCell(
  userId: string,
  documentId: string,
  kind: ResearchCellKindV1,
  source = '',
): Promise<ResearchDocumentV1 | null> {
  const document = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId },
    select: {
      id: true,
      cells: { select: { position: true }, orderBy: { position: 'desc' }, take: 1 },
    },
  });
  if (!document) {
    return null;
  }
  await assertNoOpenCellChangeReview(documentId);
  await prisma.$transaction([
    prisma.researchCell.create({
      data: {
        ...cellCreate({ kind, source }, (document.cells[0]?.position ?? -1) + 1),
        documentId,
      },
    }),
    prisma.researchDocument.update({
      where: { id: documentId },
      data: { updatedAt: new Date(), contentRevision: { increment: 1 } },
    }),
  ]);
  await analyzeAndPersist(documentId);
  return getResearchDocument(userId, documentId);
}

export async function updateResearchCell(
  userId: string,
  cellId: string,
  patch: { source?: string; config?: Record<string, unknown>; expectedRevision: number },
): Promise<ResearchDocumentV1 | null> {
  const cell = await prisma.researchCell.findFirst({
    where: { id: cellId, document: { userId } },
    select: {
      id: true,
      documentId: true,
      source: true,
      config: true,
      revision: true,
      definitions: true,
      lastExecutedRevision: true,
    },
  });
  if (!cell) {
    return null;
  }
  if (cell.revision !== patch.expectedRevision) {
    throw new ResearchCellRevisionConflictError({
      id: cell.id,
      source: cell.source,
      revision: cell.revision,
    });
  }
  const sourceChanged = patch.source !== undefined && patch.source !== cell.source;
  const configChanged =
    patch.config !== undefined && JSON.stringify(patch.config) !== JSON.stringify(cell.config);
  const contentChanged = sourceChanged || configChanged;
  if (!contentChanged) {
    return getResearchDocument(userId, cell.documentId);
  }
  const documentCells = await prisma.researchCell.findMany({
    where: { documentId: cell.documentId },
    select: {
      id: true,
      kind: true,
      source: true,
      definitions: true,
      references: true,
    },
    orderBy: { position: 'asc' },
  });
  const analyses = sourceChanged
    ? await analyzeResearchCellSources(
        cell.documentId,
        documentCells.map((candidate) => ({
          id: candidate.id,
          kind: candidate.kind,
          source:
            candidate.id === cell.id && patch.source !== undefined
              ? patch.source
              : candidate.source,
        })),
      )
    : documentCells.map((candidate) => ({
        cellId: candidate.id,
        definitions: jsonStringArray(candidate.definitions),
        references: jsonStringArray(candidate.references),
      }));
  await prisma.$transaction(async (transaction) => {
    const result = await transaction.researchCell.updateMany({
      where: { id: cell.id, revision: patch.expectedRevision },
      data: {
        ...(patch.source !== undefined ? { source: patch.source } : {}),
        ...(patch.config !== undefined
          ? { config: patch.config as unknown as Prisma.InputJsonValue }
          : {}),
        revision: { increment: 1 },
        status: cell.lastExecutedRevision == null ? 'idle' : 'stale',
      },
    });
    if (result.count === 0) {
      const current = await transaction.researchCell.findUnique({
        where: { id: cell.id },
        select: { id: true, source: true, revision: true },
      });
      if (!current) {
        throw new ResearchCellRevisionConflictError({
          id: cell.id,
          source: cell.source,
          revision: cell.revision,
        });
      }
      throw new ResearchCellRevisionConflictError(current);
    }
    if (sourceChanged) {
      const analysis = analyses.find((candidate) => candidate.cellId === cell.id);
      await transaction.researchCell.update({
        where: { id: cell.id },
        data: {
          definitions: (analysis?.definitions ?? []) as unknown as Prisma.InputJsonValue,
          references: (analysis?.references ?? []) as unknown as Prisma.InputJsonValue,
        },
      });
    }
    await transaction.researchDocument.update({
      where: { id: cell.documentId },
      data: { updatedAt: new Date(), contentRevision: { increment: 1 } },
    });
  });
  if (contentChanged) {
    const oldDefinitions = jsonStringArray(cell.definitions);
    const current = analyses.find((analysis) => analysis.cellId === cell.id);
    const seedNames = new Set([...oldDefinitions, ...(current?.definitions ?? [])]);
    await markDownstreamStale(cell.documentId, cell.id, seedNames, analyses);
  }
  return getResearchDocument(userId, cell.documentId);
}

export async function deleteResearchCell(
  userId: string,
  cellId: string,
): Promise<ResearchDocumentV1 | null> {
  const cell = await prisma.researchCell.findFirst({
    where: { id: cellId, document: { userId } },
    select: { id: true, documentId: true, definitions: true },
  });
  if (!cell) {
    return null;
  }
  await assertNoOpenCellChangeReview(cell.documentId);
  await prisma.researchCell.delete({ where: { id: cell.id } });
  const analyses = await analyzeAndPersist(cell.documentId);
  await markDownstreamStale(
    cell.documentId,
    cell.id,
    new Set(jsonStringArray(cell.definitions)),
    analyses,
  );
  await prisma.researchDocument.update({
    where: { id: cell.documentId },
    data: { updatedAt: new Date(), contentRevision: { increment: 1 } },
  });
  return getResearchDocument(userId, cell.documentId);
}

export async function analyzeResearchDocument(
  userId: string,
  documentId: string,
): Promise<ResearchDocumentAnalysisV1 | null> {
  const owner = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId },
    select: { id: true },
  });
  if (!owner) {
    return null;
  }
  const cells = await analyzeAndPersist(documentId);
  return { version: 1, cells, conflicts: dependencyConflicts(cells) };
}

export async function runResearchCell(
  userId: string,
  cellId: string,
): Promise<ResearchDocumentV1 | null> {
  const cell = await loadExecutableResearchCell(userId, cellId);
  if (!cell) {
    return null;
  }
  await assertNoOpenCellChangeReview(cell.documentId);
  const control = startResearchDocumentRun(cell.documentId);
  try {
    await executeResearchCell(cell, control);
    return getResearchDocument(userId, cell.documentId);
  } finally {
    finishResearchDocumentRun(control);
  }
}

export async function runAffectedResearchCells(
  userId: string,
  cellId: string,
): Promise<ResearchDocumentRunResultV1 | null> {
  const cell = await prisma.researchCell.findFirst({
    where: { id: cellId, document: { userId } },
    select: { id: true, documentId: true },
  });
  if (!cell) {
    return null;
  }
  await assertNoOpenCellChangeReview(cell.documentId);
  const control = startResearchDocumentRun(cell.documentId);
  try {
    const analyses = await analyzeAndPersist(cell.documentId);
    const plan = affectedResearchCellRunPlan(cell.id, analyses);
    if (control.interrupted) {
      return researchDocumentRunResult(userId, cell.documentId, [], false);
    }

    const downstreamCellIds = plan.cellIds.filter((affectedCellId) => affectedCellId !== cell.id);
    if (downstreamCellIds.length > 0) {
      await prisma.researchCell.updateMany({
        where: {
          documentId: cell.documentId,
          id: { in: downstreamCellIds },
          lastExecutedRevision: { not: null },
        },
        data: { status: 'stale' },
      });
    }

    const executedCellIds = await executeAffectedResearchCellPlan(
      plan,
      async (affectedCellId) =>
        (await executeResearchCellById(userId, affectedCellId, control)) === 'success',
      () => control.interrupted,
    );
    return researchDocumentRunResult(userId, cell.documentId, executedCellIds, false);
  } finally {
    finishResearchDocumentRun(control);
  }
}

/** Execute one prevalidated, document-scoped Cell plan and attach every immutable snapshot to the
 * same Agent proposal attempt. Content revision checks prevent a multi-tab edit from producing a
 * mixed-source attempt. */
export async function runResearchCellChangeAttemptPlan(
  userId: string,
  documentId: string,
  plan: ResearchAffectedRunPlan,
  args: {
    clean: boolean;
    attemptId: string;
    expectedContentRevision: number;
  },
): Promise<ResearchDocumentRunResultV1 | null> {
  const document = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId },
    select: { id: true },
  });
  if (!document) {
    return null;
  }

  const control = startResearchDocumentRun(documentId);
  try {
    if (args.clean) {
      await researchRuntimeManager.reset(documentId);
      if (!control.interrupted) {
        await prisma.researchCell.updateMany({
          where: { documentId, kind: 'python', lastExecutedRevision: { not: null } },
          data: { status: 'stale' },
        });
      }
    }

    const executedCellIds = await executeAffectedResearchCellPlan(
      plan,
      async (cellId) => {
        const current = await prisma.researchDocument.findUnique({
          where: { id: documentId },
          select: { contentRevision: true },
        });
        if (!current || current.contentRevision !== args.expectedContentRevision) {
          throw new ResearchDocumentContentRevisionConflictError(
            current?.contentRevision ?? args.expectedContentRevision,
          );
        }
        const outcome = await executeResearchCellById(userId, cellId, control, args.attemptId);
        return outcome === 'success';
      },
      () => control.interrupted,
    );
    const finalDocument = await prisma.researchDocument.findUnique({
      where: { id: documentId },
      select: { contentRevision: true },
    });
    if (!finalDocument || finalDocument.contentRevision !== args.expectedContentRevision) {
      throw new ResearchDocumentContentRevisionConflictError(
        finalDocument?.contentRevision ?? args.expectedContentRevision,
      );
    }
    return researchDocumentRunResult(userId, documentId, executedCellIds, args.clean);
  } finally {
    finishResearchDocumentRun(control);
  }
}

export async function runResearchDocument(
  userId: string,
  documentId: string,
  clean: boolean,
): Promise<ResearchDocumentRunResultV1 | null> {
  const owner = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId },
    select: { id: true },
  });
  if (!owner) {
    return null;
  }
  await assertNoOpenCellChangeReview(documentId);
  const control = startResearchDocumentRun(documentId);
  let researchExecutionId: string | undefined;
  try {
    if (clean) {
      await analyzeAndPersist(documentId);
      const frozen = await loadResearchExecutionSeed(userId, documentId);
      if (!frozen) {
        return null;
      }
      const researchExecution = await createResearchExecution({
        documentId,
        title: frozen.title,
        contentRevision: frozen.contentRevision,
        runtimeVersion: frozen.runtimeVersion,
        cells: frozen.cells.map(researchExecutionSourceCellSnapshot),
      });
      researchExecutionId = researchExecution.id;
      await researchRuntimeManager.reset(documentId);
      if (!control.interrupted) {
        await prisma.researchCell.updateMany({
          where: { documentId, kind: 'python', lastExecutedRevision: { not: null } },
          data: { status: 'stale' },
        });
      }

      const executedCellIds: string[] = [];
      let finalOutcome: ResearchCellExecutionOutcome = 'success';
      for (const cell of frozen.cells) {
        if (control.interrupted) {
          finalOutcome = 'interrupted';
          break;
        }
        const outcome = await executeResearchCell(cell, control, undefined, researchExecution.id);
        if (outcome !== 'interrupted') {
          executedCellIds.push(cell.id);
        }
        if (outcome === 'error' || outcome === 'interrupted') {
          finalOutcome = outcome;
          break;
        }
      }
      const execution = await finishResearchExecution({
        executionId: researchExecution.id,
        status:
          finalOutcome === 'success'
            ? 'success'
            : finalOutcome === 'interrupted'
              ? 'cancelled'
              : 'error',
        executedCellIds,
      });
      return researchDocumentRunResult(userId, documentId, executedCellIds, true, execution);
    }

    const document = await getResearchDocument(userId, documentId);
    if (!document) {
      return null;
    }
    const executedCellIds: string[] = [];
    for (const cell of document.cells) {
      if (control.interrupted) {
        break;
      }
      const outcome = await executeResearchCellById(userId, cell.id, control);
      if (!outcome) {
        return null;
      }
      if (outcome !== 'interrupted') {
        executedCellIds.push(cell.id);
      }
      if (outcome === 'error' || outcome === 'interrupted') {
        break;
      }
    }
    return researchDocumentRunResult(userId, documentId, executedCellIds, false);
  } catch (error) {
    if (researchExecutionId) {
      const active = await prisma.researchExecution.findUnique({
        where: { id: researchExecutionId },
        select: { status: true },
      });
      if (active?.status === 'running') {
        const completedCells = await prisma.researchCellExecution.findMany({
          where: { researchExecutionId, status: { not: 'cancelled' } },
          orderBy: { startedAt: 'asc' },
          select: { sourceCellId: true, cellId: true },
        });
        await finishResearchExecution({
          executionId: researchExecutionId,
          status: control.interrupted ? 'cancelled' : 'error',
          executedCellIds: completedCells.flatMap((cellExecution) => {
            const cellId = cellExecution.sourceCellId ?? cellExecution.cellId;
            return cellId ? [cellId] : [];
          }),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    throw error;
  } finally {
    finishResearchDocumentRun(control);
  }
}

export async function interruptResearchDocument(
  userId: string,
  documentId: string,
): Promise<ResearchDocumentInterruptResultV1 | null> {
  const owner = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId },
    select: { id: true },
  });
  if (!owner) {
    return null;
  }

  const control = activeResearchDocumentRuns.get(documentId);
  if (!control) {
    return {
      version: 1,
      document: (await getResearchDocument(userId, documentId))!,
      interrupted: false,
    };
  }

  control.interrupted = true;
  researchRuntimeManager.interrupt(documentId);
  await control.settled;
  return {
    version: 1,
    document: (await getResearchDocument(userId, documentId))!,
    interrupted: true,
  };
}

async function executeResearchCellById(
  userId: string,
  cellId: string,
  control: ResearchDocumentRunControl,
  cellChangeAttemptId?: string,
  researchExecutionId?: string,
): Promise<ResearchCellExecutionOutcome | null> {
  if (control.interrupted) {
    return 'interrupted';
  }
  const cell = await loadExecutableResearchCell(userId, cellId);
  return cell ? executeResearchCell(cell, control, cellChangeAttemptId, researchExecutionId) : null;
}

async function executeResearchCell(
  cell: ExecutableResearchCellRow,
  control: ResearchDocumentRunControl,
  cellChangeAttemptId?: string,
  researchExecutionId?: string,
): Promise<ResearchCellExecutionOutcome> {
  if (control.interrupted) {
    return 'interrupted';
  }

  const executionId = ulid();
  const startedAt = new Date();
  await prisma.$transaction(async (transaction) => {
    const current = await transaction.researchCell.findUnique({
      where: { id: cell.id },
      select: { id: true, revision: true, source: true },
    });
    if (current?.revision === cell.revision && current.source === cell.source) {
      await transaction.researchCell.update({
        where: { id: current.id },
        data: { status: 'running' },
      });
    }
    await transaction.researchCellExecution.create({
      data: {
        id: executionId,
        documentId: cell.documentId,
        ...(current ? { cellId: current.id } : {}),
        sourceCellId: cell.id,
        sourcePosition: cell.position,
        sourceKind: cell.kind,
        revision: cell.revision,
        source: cell.source,
        status: 'running',
        definitions: cell.definitions as Prisma.InputJsonValue,
        references: cell.references as Prisma.InputJsonValue,
        environmentFingerprint: 'pending',
        startedAt,
        ...(cellChangeAttemptId ? { cellChangeAttemptId } : {}),
        ...(researchExecutionId ? { researchExecutionId } : {}),
      },
    });
  });

  if (control.interrupted) {
    await persistInterruptedResearchCell(cell, executionId);
    return 'interrupted';
  }

  try {
    const result = await executeCell(cell);
    let persisted;
    try {
      persisted = materializeResearchOutputArtifacts(result.outputs, cell.documentId, executionId);
    } catch (error) {
      throw new ResearchPythonExecutionError(
        error instanceof Error ? error.message : String(error),
        [],
        result.definitions,
        result.references,
        result.environmentFingerprint,
      );
    }
    await prisma.$transaction(async (transaction) => {
      for (const artifact of persisted.artifacts) {
        await transaction.researchArtifact.create({ data: artifact });
      }
      await transaction.researchCell.updateMany({
        where: { id: cell.id, revision: cell.revision, source: cell.source },
        data: {
          status: 'success',
          output: persisted.outputs as unknown as Prisma.InputJsonValue,
          definitions: result.definitions as unknown as Prisma.InputJsonValue,
          references: result.references as unknown as Prisma.InputJsonValue,
          lastExecutedRevision: cell.revision,
          lastExecutedAt: new Date(),
        },
      });
      await transaction.researchCellExecution.update({
        where: { id: executionId },
        data: {
          status: 'success',
          output: persisted.outputs as unknown as Prisma.InputJsonValue,
          definitions: result.definitions as unknown as Prisma.InputJsonValue,
          references: result.references as unknown as Prisma.InputJsonValue,
          environmentFingerprint: result.environmentFingerprint,
          finishedAt: new Date(),
        },
      });
      await transaction.researchDocument.update({
        where: { id: cell.documentId },
        data: { updatedAt: new Date() },
      });
    });
    return 'success';
  } catch (error) {
    if (error instanceof ResearchPythonInterruptionError) {
      await persistInterruptedResearchCell(cell, executionId, error.environmentFingerprint);
      return 'interrupted';
    }

    const failure = executionFailure(error);
    const outputs: ResearchCellOutputBlockV1[] = [
      ...failure.outputs,
      { type: 'text', text: failure.message, level: 'error' },
    ];
    await prisma.$transaction([
      prisma.researchCell.updateMany({
        where: { id: cell.id, revision: cell.revision, source: cell.source },
        data: {
          status: 'error',
          output: outputs as unknown as Prisma.InputJsonValue,
          definitions: failure.definitions as unknown as Prisma.InputJsonValue,
          references: failure.references as unknown as Prisma.InputJsonValue,
          lastExecutedAt: new Date(),
        },
      }),
      prisma.researchCellExecution.update({
        where: { id: executionId },
        data: {
          status: 'error',
          output: outputs as unknown as Prisma.InputJsonValue,
          error: failure.message.slice(0, 8_000),
          definitions: failure.definitions as unknown as Prisma.InputJsonValue,
          references: failure.references as unknown as Prisma.InputJsonValue,
          environmentFingerprint: failure.environmentFingerprint,
          finishedAt: new Date(),
        },
      }),
      prisma.researchDocument.update({
        where: { id: cell.documentId },
        data: { updatedAt: new Date() },
      }),
    ]);
    return 'error';
  }
}

async function persistInterruptedResearchCell(
  cell: ExecutableResearchCellRow,
  executionId: string,
  environmentFingerprint = researchPayloadHash({ runtime: 'research-py-v1', interrupted: true }),
): Promise<void> {
  await prisma.$transaction([
    prisma.researchCell.updateMany({
      where: { id: cell.id, revision: cell.revision, source: cell.source },
      data: { status: cell.lastExecutedRevision == null ? 'idle' : 'stale' },
    }),
    prisma.researchCellExecution.update({
      where: { id: executionId },
      data: {
        status: 'cancelled',
        error: 'Research cell execution was interrupted',
        environmentFingerprint,
        finishedAt: new Date(),
      },
    }),
    prisma.researchDocument.update({
      where: { id: cell.documentId },
      data: { updatedAt: new Date() },
    }),
  ]);
}

function startResearchDocumentRun(documentId: string): ResearchDocumentRunControl {
  if (activeResearchDocumentRuns.has(documentId)) {
    throw new ResearchDocumentRunInProgressError();
  }

  let settle = () => {};
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const control = { documentId, interrupted: false, settled, settle };
  activeResearchDocumentRuns.set(documentId, control);
  return control;
}

async function assertNoOpenCellChangeReview(documentId: string): Promise<void> {
  const review = await prisma.researchCellChangeProposal.findFirst({
    where: { documentId, reviewStatus: 'open' },
    select: { id: true },
  });
  if (review) {
    throw new ResearchCellChangeReviewOpenError();
  }
}

function finishResearchDocumentRun(control: ResearchDocumentRunControl): void {
  if (activeResearchDocumentRuns.get(control.documentId) === control) {
    activeResearchDocumentRuns.delete(control.documentId);
  }
  control.settle();
}

async function researchDocumentRunResult(
  userId: string,
  documentId: string,
  executedCellIds: string[],
  clean: boolean,
  execution?: ResearchExecutionSummaryV1,
): Promise<ResearchDocumentRunResultV1> {
  return {
    version: 1,
    document: (await getResearchDocument(userId, documentId))!,
    executedCellIds,
    clean,
    ...(execution ? { execution } : {}),
  };
}

async function loadResearchExecutionSeed(userId: string, documentId: string) {
  const document = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId },
    select: {
      id: true,
      conversationId: true,
      runtimeVersion: true,
      contentRevision: true,
      conversation: { select: { title: true, userId: true } },
      cells: { orderBy: { position: 'asc' } },
    },
  });
  if (!document) {
    return null;
  }
  const documentContext = {
    conversationId: document.conversationId,
    conversation: document.conversation,
  };
  return {
    title: document.conversation.title ?? '',
    runtimeVersion: document.runtimeVersion,
    contentRevision: document.contentRevision,
    cells: document.cells.map(
      (cell): ExecutableResearchCellRow => ({
        ...cell,
        document: documentContext,
      }),
    ),
  };
}

function researchExecutionSourceCellSnapshot(
  cell: ExecutableResearchCellRow,
): ResearchExecutionSourceCellSnapshot {
  return {
    id: cell.id,
    position: cell.position,
    kind: cell.kind as ResearchCellKindV1,
    source: cell.source,
    ...(cell.config ? { config: cell.config as Record<string, unknown> } : {}),
    revision: cell.revision,
    definitions: jsonStringArray(cell.definitions),
    references: jsonStringArray(cell.references),
  };
}

async function loadExecutableResearchCell(
  userId: string,
  cellId: string,
): Promise<ExecutableResearchCellRow | null> {
  return prisma.researchCell.findFirst({
    where: { id: cellId, document: { userId } },
    include: { document: { include: { conversation: true } } },
  });
}

export async function resetResearchDocumentRuntime(
  userId: string,
  documentId: string,
): Promise<ResearchDocumentV1 | null> {
  const owner = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId },
    select: { id: true },
  });
  if (!owner) {
    return null;
  }
  await assertNoOpenCellChangeReview(documentId);
  await researchRuntimeManager.reset(documentId);
  await prisma.researchCell.updateMany({
    where: { documentId, kind: 'python', lastExecutedRevision: { not: null } },
    data: { status: 'stale' },
  });
  return getResearchDocument(userId, documentId);
}

export function closeResearchDocumentRuntime(documentId: string): void {
  researchRuntimeManager.close(documentId);
}

async function executeCell(cell: {
  id: string;
  documentId: string;
  kind: string;
  source: string;
  document: { conversationId: string; conversation: { title: string | null; userId: string } };
}) {
  switch (cell.kind) {
    case 'markdown':
      return {
        outputs: [] as ResearchCellOutputBlockV1[],
        definitions: [] as string[],
        references: [] as string[],
        environmentFingerprint: researchPayloadHash({ renderer: 'markdown-v1' }),
      };
    case 'python':
      return researchRuntimeManager.execute(cell.documentId, cell);
    default:
      throw new Error(`unknown research cell kind: ${cell.kind}`);
  }
}

async function analyzeAndPersist(documentId: string): Promise<ResearchPythonAnalysis[]> {
  const cells = await prisma.researchCell.findMany({
    where: { documentId },
    select: { id: true, kind: true, source: true },
    orderBy: { position: 'asc' },
  });
  const analyses = await analyzeResearchCellSources(documentId, cells);
  await prisma.$transaction(
    analyses.map((analysis) =>
      prisma.researchCell.update({
        where: { id: analysis.cellId },
        data: {
          definitions: analysis.definitions as unknown as Prisma.InputJsonValue,
          references: analysis.references as unknown as Prisma.InputJsonValue,
        },
      }),
    ),
  );
  return analyses;
}

async function analyzeResearchCellSources(
  documentId: string,
  cells: Array<{ id: string; kind: string; source: string }>,
): Promise<ResearchPythonAnalysis[]> {
  const pythonCells = cells.filter((cell) => cell.kind === 'python');
  const pythonAnalyses =
    pythonCells.length > 0 ? await researchRuntimeManager.analyze(documentId, pythonCells) : [];
  const analysisById = new Map(pythonAnalyses.map((analysis) => [analysis.cellId, analysis]));
  const analyses = cells.map(
    (cell): ResearchPythonAnalysis =>
      analysisById.get(cell.id) ?? { cellId: cell.id, definitions: [], references: [] },
  );
  return analyses;
}

async function markDownstreamStale(
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
      lastExecutedRevision: { not: null },
    },
    data: { status: 'stale' },
  });
}

export function downstreamResearchCellIds(
  changedCellId: string,
  seedNames: Set<string>,
  analyses: ResearchPythonAnalysis[],
): string[] {
  const stale = new Set<string>();
  const pendingNames = [...seedNames];
  const visitedNames = new Set<string>();
  while (pendingNames.length > 0) {
    const name = pendingNames.shift()!;
    if (visitedNames.has(name)) {
      continue;
    }
    visitedNames.add(name);
    for (const analysis of analyses) {
      if (
        analysis.cellId !== changedCellId &&
        !stale.has(analysis.cellId) &&
        analysis.references.includes(name)
      ) {
        stale.add(analysis.cellId);
        pendingNames.push(...analysis.definitions);
      }
    }
  }
  return [...stale];
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
    throw new ResearchAffectedRunError('duplicate_definitions', conflicts);
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
    throw new ResearchAffectedRunError('cyclic_dependency', cyclicCellIds);
  }

  return { cellIds: orderedCellIds, dependenciesByCellId: affectedDependenciesByCellId };
}

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

function dependencyConflicts(analyses: ResearchPythonAnalysis[]): ResearchDependencyConflictV1[] {
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

async function loadDocumentRow(
  userId: string,
  documentId: string,
): Promise<ResearchDocumentRow | null> {
  return prisma.researchDocument.findFirst({
    where: { id: documentId, userId },
    include: {
      conversation: {
        include: { messages: { orderBy: { sequence: 'asc' }, take: 100 } },
      },
      cells: { orderBy: { position: 'asc' } },
      cellChangeProposals: {
        where: { reviewStatus: 'open' },
        orderBy: { reviewSequence: 'asc' },
      },
    },
  });
}

function documentView(document: ResearchDocumentRow): ResearchDocumentV1 {
  const activeCellChangeReview = researchCellChangeReviewView(document.cellChangeProposals);
  return {
    version: 1,
    id: document.id,
    conversationId: document.conversationId,
    title: document.conversation.title ?? '',
    runtimeVersion: 'research-py-v1',
    contentRevision: document.contentRevision,
    cells: document.cells.map(cellView),
    ...(activeCellChangeReview ? { activeCellChangeReview } : {}),
    cellChangeAttempts: [],
    messages: document.conversation.messages.map(
      (message): ChatMessage => ({
        id: message.id,
        role: message.role === 'assistant' ? 'assistant' : 'user',
        parts: message.parts as unknown as ChatMessage['parts'],
        turnId: message.turnId ?? undefined,
        sequence: message.sequence,
        createdAt: message.createdAt.toISOString(),
      }),
    ),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function cellView(cell: ResearchDocumentRow['cells'][number]): ResearchCellV1 {
  return {
    version: 1,
    id: cell.id,
    documentId: cell.documentId,
    position: cell.position,
    kind: cell.kind as ResearchCellKindV1,
    source: cell.source,
    ...(cell.config ? { config: cell.config as Record<string, unknown> } : {}),
    status: cell.status as ResearchCellV1['status'],
    revision: cell.revision,
    definitions: jsonStringArray(cell.definitions),
    references: jsonStringArray(cell.references),
    outputs: Array.isArray(cell.output)
      ? (cell.output as unknown as ResearchCellOutputBlockV1[])
      : [],
    ...(cell.lastExecutedRevision != null
      ? { lastExecutedRevision: cell.lastExecutedRevision }
      : {}),
    ...(cell.lastExecutedAt ? { lastExecutedAt: cell.lastExecutedAt.toISOString() } : {}),
    createdAt: cell.createdAt.toISOString(),
    updatedAt: cell.updatedAt.toISOString(),
  };
}

function cellCreate(cell: CellSeed, position: number) {
  return {
    id: ulid(),
    position,
    kind: cell.kind,
    source: cell.source,
    ...(cell.config ? { config: cell.config as unknown as Prisma.InputJsonValue } : {}),
    definitions: [] as unknown as Prisma.InputJsonValue,
    references: [] as unknown as Prisma.InputJsonValue,
  };
}

function templateDefinition(template: ResearchDocumentTemplateV1): {
  title: string;
  cells: CellSeed[];
} {
  switch (template) {
    case 'blank':
      return {
        title: '未命名量化研究',
        cells: [
          {
            kind: 'markdown',
            source:
              '# 研究问题\n\n先写下问题、事前假设、样本区间和判断标准，再用 Python Cell 探索。',
          },
          {
            kind: 'python',
            source:
              '# data.series() 返回平台口径一致的 pandas DataFrame\n# result = data.series("index", "000300.SH", start="20200101", end="20251231")\n',
          },
        ],
      };
    case 'index_relationship':
      return indexRelationshipTemplate();
  }
}

function legacyDefinition(title: string): { cells: CellSeed[] } {
  return {
    cells: [
      {
        kind: 'markdown',
        source: `# ${title || '历史研究'}\n\n此文档由旧版研究会话升级。右侧保留原有 Agent 对话；可在下方继续添加 Markdown 或 Python Cell。`,
      },
    ],
  };
}

function indexRelationshipTemplate(): { title: string; cells: CellSeed[] } {
  return {
    title: '沪深300 vs 中证500：月收益关系',
    cells: [
      {
        kind: 'markdown',
        source:
          '# 沪深300 vs 中证500：月收益关系\n\n**事前假设**：2020–2025 年间，两类宽基指数的月收益正相关。\n\n以中证500月收益 $r_{500,t}$ 为因变量、沪深300月收益 $r_{300,t}$ 为自变量，估计 $r_{500,t}=\\alpha+\\beta r_{300,t}+\\epsilon_t$。原假设为 $H_0:\\beta=0$，使用 HAC 标准误处理残差的异方差与有限阶自相关，同时查看 Pearson 相关、效应大小和 24 个月滚动相关。相关关系不代表因果，也未包含交易成本或样本外预测检验。',
      },
      {
        kind: 'python',
        source: `csi300 = data.series(
    "index", "000300.SH", start="20200101", end="20251231",
    frequency="monthly", transform="simple_return"
).rename(columns={"value": "csi300"})
csi500 = data.series(
    "index", "000905.SH", start="20200101", end="20251231",
    frequency="monthly", transform="simple_return"
).rename(columns={"value": "csi500"})
monthly = csi300.merge(csi500, on="date", how="inner")
monthly.tail(8)`,
      },
      {
        kind: 'python',
        source: `import pandas as pd
import statsmodels.api as sm

model_data = monthly[["csi300", "csi500"]].dropna()
hac_lag = max(1, int(4 * (len(model_data) / 100) ** (2 / 9)))
fit = sm.OLS(model_data["csi500"], sm.add_constant(model_data["csi300"])).fit(
    cov_type="HAC", cov_kwds={"maxlags": hac_lag}
)
relationship_summary = pd.DataFrame({
    "observations": [len(model_data)],
    "pearson": [model_data["csi300"].corr(model_data["csi500"])],
    "slope": [fit.params["csi300"]],
    "hac_se": [fit.bse["csi300"]],
    "p_value": [fit.pvalues["csi300"]],
    "ci_lower": [fit.conf_int().loc["csi300", 0]],
    "ci_upper": [fit.conf_int().loc["csi300", 1]],
    "r_squared": [fit.rsquared],
}).round(4)
relationship_summary`,
      },
      {
        kind: 'python',
        source: `rolling = monthly.assign(
    rolling_corr=monthly["csi300"].rolling(24).corr(monthly["csi500"])
).dropna(subset=["rolling_corr"])
charts.line(
    rolling, x="date", y="rolling_corr",
    labels={"rolling_corr": "24个月滚动相关"},
    title="沪深300与中证500月收益滚动相关"
)`,
      },
    ],
  };
}

function executionFailure(error: unknown) {
  if (error instanceof ResearchPythonExecutionError) {
    return {
      message: error.message,
      outputs: error.outputs,
      definitions: error.definitions,
      references: error.references,
      environmentFingerprint: error.environmentFingerprint,
    };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    outputs: [] as ResearchCellOutputBlockV1[],
    definitions: [] as string[],
    references: [] as string[],
    environmentFingerprint: researchPayloadHash({ runtime: 'unknown' }),
  };
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function messagePreview(parts: Prisma.JsonValue | undefined): string {
  if (!Array.isArray(parts)) {
    return '';
  }
  for (const part of parts) {
    if (typeof part === 'object' && part !== null && !Array.isArray(part)) {
      if (part.type === 'text' && typeof part.text === 'string') {
        return part.text.slice(0, 80);
      }
      if (
        (part.type === 'research' || part.type === 'universe') &&
        typeof part.title === 'string'
      ) {
        return part.title.slice(0, 80);
      }
    }
  }
  return '';
}
