import type { Prisma } from '@prisma/client';
import type {
  ChatMessage,
  ResearchCellKindV1,
  ResearchCellOutputBlockV1,
  ResearchCellV1,
  ResearchDependencyConflictV1,
  ResearchDocumentAnalysisV1,
  ResearchDocumentInterruptResultV1,
  ResearchDocumentRunResultV1,
  ResearchDocumentSummaryV1,
  ResearchDocumentTemplateV1,
  ResearchDocumentV1,
  ResearchPlanSpecV1,
} from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '../lib/prisma.js';
import { executeResearchPlan } from './executor.js';
import { researchPayloadHash } from './fingerprints.js';
import { createWorkbenchResearchRun } from './records.js';
import { researchPlanSpecV1Schema } from './spec.js';
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
  };
}>;

type ExecutableResearchCellRow = Prisma.ResearchCellGetPayload<{
  include: { document: { include: { conversation: true } } };
}>;

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

interface ResearchRunControl {
  documentId: string;
  interrupted: boolean;
  settled: Promise<void>;
  settle: () => void;
}

type ResearchCellExecutionOutcome = 'success' | 'error' | 'interrupted';

const activeResearchRuns = new Map<string, ResearchRunControl>();

export class ResearchDocumentRunInProgressError extends Error {
  public constructor() {
    super('Research document already has an active run');
    this.name = 'ResearchDocumentRunInProgressError';
  }
}

export async function listResearchDocuments(userId: string): Promise<ResearchDocumentSummaryV1[]> {
  const conversations = await prisma.agentConversation.findMany({
    where: { userId, surface: 'research', archivedAt: null },
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
    orderBy: { updatedAt: 'desc' },
  });
  return conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title ?? '',
    preview: messagePreview(conversation.messages[0]?.parts),
    cellCount: conversation.researchDocument?.cells.length ?? 0,
    staleCount:
      conversation.researchDocument?.cells.filter((cell) => cell.status === 'stale').length ?? 0,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  }));
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
  return document ? documentView(document) : null;
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
  await prisma.$transaction([
    prisma.researchCell.create({
      data: {
        ...cellCreate({ kind, source }, (document.cells[0]?.position ?? -1) + 1),
        documentId,
      },
    }),
    prisma.researchDocument.update({ where: { id: documentId }, data: { updatedAt: new Date() } }),
  ]);
  await analyzeAndPersist(documentId);
  return getResearchDocument(userId, documentId);
}

export async function updateResearchCell(
  userId: string,
  cellId: string,
  patch: { source?: string; config?: Record<string, unknown> },
): Promise<ResearchDocumentV1 | null> {
  const cell = await prisma.researchCell.findFirst({
    where: { id: cellId, document: { userId } },
    select: {
      id: true,
      documentId: true,
      source: true,
      revision: true,
      definitions: true,
      lastExecutedRevision: true,
    },
  });
  if (!cell) {
    return null;
  }
  const sourceChanged = patch.source !== undefined && patch.source !== cell.source;
  await prisma.researchCell.update({
    where: { id: cell.id },
    data: {
      ...(patch.source !== undefined ? { source: patch.source } : {}),
      ...(patch.config !== undefined
        ? { config: patch.config as unknown as Prisma.InputJsonValue }
        : {}),
      ...(sourceChanged ? { revision: { increment: 1 } } : {}),
      ...(sourceChanged ? { status: cell.lastExecutedRevision == null ? 'idle' : 'stale' } : {}),
    },
  });
  const analyses = await analyzeAndPersist(cell.documentId);
  if (sourceChanged) {
    const oldDefinitions = jsonStringArray(cell.definitions);
    const current = analyses.find((analysis) => analysis.cellId === cell.id);
    const seedNames = new Set([...oldDefinitions, ...(current?.definitions ?? [])]);
    await markDownstreamStale(cell.documentId, cell.id, seedNames, analyses);
  }
  await touchDocument(cell.documentId);
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
  await prisma.researchCell.delete({ where: { id: cell.id } });
  const analyses = await analyzeAndPersist(cell.documentId);
  await markDownstreamStale(
    cell.documentId,
    cell.id,
    new Set(jsonStringArray(cell.definitions)),
    analyses,
  );
  await touchDocument(cell.documentId);
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
  const control = startResearchRun(cell.documentId);
  try {
    await executeResearchCell(cell, control);
    return getResearchDocument(userId, cell.documentId);
  } finally {
    finishResearchRun(control);
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
  const control = startResearchRun(cell.documentId);
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
    finishResearchRun(control);
  }
}

export async function runResearchDocument(
  userId: string,
  documentId: string,
  clean: boolean,
): Promise<ResearchDocumentRunResultV1 | null> {
  const document = await getResearchDocument(userId, documentId);
  if (!document) {
    return null;
  }
  const control = startResearchRun(documentId);
  try {
    if (clean) {
      await researchRuntimeManager.reset(documentId);
      if (!control.interrupted) {
        await prisma.researchCell.updateMany({
          where: { documentId, kind: 'python', lastExecutedRevision: { not: null } },
          data: { status: 'stale' },
        });
      }
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
    return researchDocumentRunResult(userId, documentId, executedCellIds, clean);
  } finally {
    finishResearchRun(control);
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

  const control = activeResearchRuns.get(documentId);
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
  control: ResearchRunControl,
): Promise<ResearchCellExecutionOutcome | null> {
  if (control.interrupted) {
    return 'interrupted';
  }
  const cell = await loadExecutableResearchCell(userId, cellId);
  return cell ? executeResearchCell(cell, control) : null;
}

async function executeResearchCell(
  cell: ExecutableResearchCellRow,
  control: ResearchRunControl,
): Promise<ResearchCellExecutionOutcome> {
  if (control.interrupted) {
    return 'interrupted';
  }

  const executionId = ulid();
  const startedAt = new Date();
  await prisma.$transaction([
    prisma.researchCell.update({ where: { id: cell.id }, data: { status: 'running' } }),
    prisma.researchCellExecution.create({
      data: {
        id: executionId,
        documentId: cell.documentId,
        cellId: cell.id,
        revision: cell.revision,
        source: cell.source,
        status: 'running',
        definitions: cell.definitions as Prisma.InputJsonValue,
        references: cell.references as Prisma.InputJsonValue,
        environmentFingerprint: 'pending',
        startedAt,
      },
    }),
  ]);

  if (control.interrupted) {
    await persistInterruptedResearchCell(cell, executionId);
    return 'interrupted';
  }

  try {
    const result = await executeCell(cell);
    await prisma.$transaction([
      prisma.researchCell.update({
        where: { id: cell.id },
        data: {
          status: 'success',
          output: result.outputs as unknown as Prisma.InputJsonValue,
          definitions: result.definitions as unknown as Prisma.InputJsonValue,
          references: result.references as unknown as Prisma.InputJsonValue,
          lastExecutedRevision: cell.revision,
          lastExecutedAt: new Date(),
        },
      }),
      prisma.researchCellExecution.update({
        where: { id: executionId },
        data: {
          status: 'success',
          output: result.outputs as unknown as Prisma.InputJsonValue,
          definitions: result.definitions as unknown as Prisma.InputJsonValue,
          references: result.references as unknown as Prisma.InputJsonValue,
          environmentFingerprint: result.environmentFingerprint,
          finishedAt: new Date(),
        },
      }),
      prisma.researchDocument.update({
        where: { id: cell.documentId },
        data: { updatedAt: new Date() },
      }),
    ]);
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
      prisma.researchCell.update({
        where: { id: cell.id },
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
    prisma.researchCell.update({
      where: { id: cell.id },
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

function startResearchRun(documentId: string): ResearchRunControl {
  if (activeResearchRuns.has(documentId)) {
    throw new ResearchDocumentRunInProgressError();
  }

  let settle = () => {};
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const control = { documentId, interrupted: false, settled, settle };
  activeResearchRuns.set(documentId, control);
  return control;
}

function finishResearchRun(control: ResearchRunControl): void {
  if (activeResearchRuns.get(control.documentId) === control) {
    activeResearchRuns.delete(control.documentId);
  }
  control.settle();
}

async function researchDocumentRunResult(
  userId: string,
  documentId: string,
  executedCellIds: string[],
  clean: boolean,
): Promise<ResearchDocumentRunResultV1> {
  return {
    version: 1,
    document: (await getResearchDocument(userId, documentId))!,
    executedCellIds,
    clean,
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
    case 'validation': {
      let value: unknown;
      try {
        value = JSON.parse(cell.source);
      } catch (error) {
        throw new Error(
          `Validation Cell JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const plan = researchPlanSpecV1Schema.parse(value) as ResearchPlanSpecV1;
      const run = await executeResearchPlan(plan);
      const title = cell.document.conversation.title ?? plan.question.text.slice(0, 120);
      const part = await createWorkbenchResearchRun({
        userId: cell.document.conversation.userId,
        conversationId: cell.document.conversationId,
        title,
        run,
      });
      if (!part.record) {
        throw new Error('Validation run was not persisted');
      }
      return {
        outputs: [
          { type: 'validation', title: part.title, run: part.run, record: part.record },
        ] as ResearchCellOutputBlockV1[],
        definitions: [] as string[],
        references: [] as string[],
        environmentFingerprint:
          run.fingerprints?.environment.hash ??
          researchPayloadHash({ runtime: 'research-protocol' }),
      };
    }
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
  const pythonCells = cells.filter((cell) => cell.kind === 'python');
  const pythonAnalyses =
    pythonCells.length > 0 ? await researchRuntimeManager.analyze(documentId, pythonCells) : [];
  const analysisById = new Map(pythonAnalyses.map((analysis) => [analysis.cellId, analysis]));
  const analyses = cells.map(
    (cell): ResearchPythonAnalysis =>
      analysisById.get(cell.id) ?? { cellId: cell.id, definitions: [], references: [] },
  );
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
  selectedCellId: string,
  analyses: ResearchPythonAnalysis[],
): ResearchAffectedRunPlan {
  const orderByCellId = new Map(analyses.map((analysis, index) => [analysis.cellId, index]));
  if (!orderByCellId.has(selectedCellId)) {
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

  const affectedCellIds = new Set([selectedCellId]);
  const pendingCellIds = [selectedCellId];
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
    },
  });
}

function documentView(document: ResearchDocumentRow): ResearchDocumentV1 {
  return {
    version: 1,
    id: document.id,
    conversationId: document.conversationId,
    title: document.conversation.title ?? '',
    runtimeVersion: 'research-py-v1',
    cells: document.cells.map(cellView),
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
        source: `# ${title || '历史研究'}\n\n此文档由旧版研究会话升级。右侧保留原有 Agent 对话；可在下方继续添加 Python 或 Validation Cell。`,
      },
    ],
  };
}

function indexRelationshipTemplate(): { title: string; cells: CellSeed[] } {
  const plan: ResearchPlanSpecV1 = {
    version: 1,
    question: {
      version: 1,
      kind: 'time_series_relationship',
      text: '沪深300和中证500的月收益是否正相关？',
      hypothesis: { estimand: 'regression_slope', direction: 'positive', nullValue: 0 },
    },
    start: '20200101',
    end: '20251231',
    inputs: [
      {
        type: 'series',
        id: 'csi300',
        source: { kind: 'instrument', assetType: 'index', id: '000300.SH' },
        measure: 'market.adjusted_close',
        transform: 'simple_return',
        label: '沪深300',
      },
      {
        type: 'series',
        id: 'csi500',
        source: { kind: 'instrument', assetType: 'index', id: '000905.SH' },
        measure: 'market.adjusted_close',
        transform: 'simple_return',
        label: '中证500',
      },
    ],
    alignment: { frequency: 'monthly', join: 'inner', partialPeriod: 'exclude' },
    protocol: {
      kind: 'time_series_relationship',
      version: 1,
      predictor: 'csi300',
      outcome: 'csi500',
      predictorLag: 0,
      correlations: ['pearson', 'spearman'],
      inference: { kind: 'newey_west', lag: 'automatic' },
      rollingWindow: 24,
    },
    outputs: [
      { kind: 'summary_table' },
      { kind: 'scatter' },
      { kind: 'rolling_relationship' },
      { kind: 'conclusion' },
      { kind: 'formula' },
      { kind: 'python_example' },
      { kind: 'documentation' },
    ],
  };
  return {
    title: '沪深300 vs 中证500：月收益关系',
    cells: [
      {
        kind: 'markdown',
        source:
          '# 沪深300 vs 中证500：月收益关系\n\n**事前假设**：2020–2025 年间，两类宽基指数的月收益正相关。先自由探索数据与累计路径，再交给版本化协议做 HAC 推断和滚动稳定性验证。',
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
        source: `correlation = monthly[["csi300", "csi500"]].corr().round(3)
correlation`,
      },
      {
        kind: 'python',
        source: `indexed = monthly.assign(
    csi300_nav=(1 + monthly["csi300"]).cumprod(),
    csi500_nav=(1 + monthly["csi500"]).cumprod(),
)
charts.line(
    indexed, x="date", y=["csi300_nav", "csi500_nav"],
    labels={"csi300_nav": "沪深300", "csi500_nav": "中证500"},
    title="月度累计净值（探索输出）"
)`,
      },
      {
        kind: 'validation',
        source: JSON.stringify(plan, null, 2),
        config: { protocolId: 'time_series_relationship', protocolVersion: 1 },
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

async function touchDocument(documentId: string): Promise<void> {
  await prisma.researchDocument.update({
    where: { id: documentId },
    data: { updatedAt: new Date() },
  });
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
