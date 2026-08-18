import type {
  ResearchCellChangeAttemptScopeV1,
  ResearchCellChangeAttemptStatusV1,
  ResearchCellChangeOperationV1,
  ResearchCellChangeRunResultV1,
} from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '../lib/prisma.js';
import {
  affectedResearchCellRunPlan,
  analyzeResearchDocument,
  getResearchDocument,
  isResearchDocumentRunActive,
  ResearchAffectedRunError,
  ResearchDocumentContentRevisionConflictError,
  ResearchDocumentRunInProgressError,
  runResearchCellChangeAttemptPlan,
  type ResearchAffectedRunPlan,
} from './workbench.js';

export type ResearchCellChangeAttemptUnavailableReason =
  | 'proposal_not_applied'
  | 'proposal_revision_unavailable'
  | 'document_changed'
  | 'no_executable_cells';

export class ResearchCellChangeAttemptUnavailableError extends Error {
  public constructor(readonly reason: ResearchCellChangeAttemptUnavailableReason) {
    super(reason);
    this.name = 'ResearchCellChangeAttemptUnavailableError';
  }
}

/** Run an applied Agent proposal only after a separate user action, retaining failures as attempts. */
export async function runResearchCellChangeProposalAttempt(
  userId: string,
  proposalId: string,
): Promise<ResearchCellChangeRunResultV1 | null> {
  const proposal = await prisma.researchCellChangeProposal.findFirst({
    where: { id: proposalId, document: { userId } },
    include: {
      document: {
        include: { cells: { orderBy: { position: 'asc' } } },
      },
    },
  });
  if (!proposal) {
    return null;
  }
  if (proposal.status !== 'applied') {
    throw new ResearchCellChangeAttemptUnavailableError('proposal_not_applied');
  }
  if (proposal.appliedDocumentContentRevision == null) {
    throw new ResearchCellChangeAttemptUnavailableError('proposal_revision_unavailable');
  }
  if (proposal.document.contentRevision !== proposal.appliedDocumentContentRevision) {
    throw new ResearchCellChangeAttemptUnavailableError('document_changed');
  }
  if (isResearchDocumentRunActive(proposal.documentId)) {
    throw new ResearchDocumentRunInProgressError();
  }

  const operations = proposal.operations as unknown as ResearchCellChangeOperationV1[];
  const rootCellIds = executableRootCellIds(operations);
  if (rootCellIds.length === 0) {
    throw new ResearchCellChangeAttemptUnavailableError('no_executable_cells');
  }
  const scope: ResearchCellChangeAttemptScopeV1 = operations.some(
    (operation) => operation.kind === 'delete' && operation.cellKind === 'python',
  )
    ? 'clean_document'
    : 'affected';
  const attemptId = ulid();
  await prisma.researchCellChangeAttempt.create({
    data: {
      id: attemptId,
      documentId: proposal.documentId,
      proposalId: proposal.id,
      contentRevision: proposal.document.contentRevision,
      scope,
      rootCellIds,
      plannedCellIds: [],
      startedAt: new Date(),
    },
  });

  try {
    const plan = await cellChangeAttemptPlan(
      userId,
      proposal.documentId,
      proposal.document.cells,
      operations,
      scope,
    );
    await prisma.researchCellChangeAttempt.update({
      where: { id: attemptId },
      data: { plannedCellIds: plan.cellIds },
    });
    const result = await runResearchCellChangeAttemptPlan(userId, proposal.documentId, plan, {
      clean: scope === 'clean_document',
      attemptId,
      expectedContentRevision: proposal.document.contentRevision,
    });
    if (!result) {
      return null;
    }
    await finishCellChangeAttempt(attemptId, plan.cellIds.length);
  } catch (error) {
    const message = attemptErrorMessage(error);
    await prisma.researchCellChangeAttempt.updateMany({
      where: { id: attemptId, status: 'running' },
      data: {
        status: 'error',
        error: message.slice(0, 8_000),
        finishedAt: new Date(),
      },
    });
    if (error instanceof ResearchDocumentRunInProgressError) {
      throw error;
    }
    if (
      !(error instanceof ResearchAffectedRunError) &&
      !(error instanceof ResearchDocumentContentRevisionConflictError)
    ) {
      throw error;
    }
  }

  const document = await getResearchDocument(userId, proposal.documentId);
  const attempt = document?.cellChangeAttempts.find((candidate) => candidate.id === attemptId);
  return document && attempt ? { version: 1, attempt, document } : null;
}

function executableRootCellIds(operations: ResearchCellChangeOperationV1[]): string[] {
  return operations
    .filter(
      (operation) =>
        (operation.kind !== 'delete' &&
          (operation.cellKind === 'python' || operation.cellKind === 'validation')) ||
        (operation.kind === 'delete' && operation.cellKind === 'python'),
    )
    .map((operation) => operation.cellId);
}

async function cellChangeAttemptPlan(
  userId: string,
  documentId: string,
  cells: Array<{ id: string; position: number; kind: string }>,
  operations: ResearchCellChangeOperationV1[],
  scope: ResearchCellChangeAttemptScopeV1,
): Promise<ResearchAffectedRunPlan> {
  const analysis = await analyzeResearchDocument(userId, documentId);
  if (!analysis) {
    return { cellIds: [], dependenciesByCellId: new Map() };
  }
  const pythonRootCellIds =
    scope === 'clean_document'
      ? analysis.cells.map((cell) => cell.cellId)
      : operations
          .filter((operation) => operation.kind !== 'delete' && operation.cellKind === 'python')
          .map((operation) => operation.cellId);
  const pythonPlan = affectedResearchCellRunPlan(pythonRootCellIds, analysis.cells);
  const includedCellIds = new Set(pythonPlan.cellIds);
  if (scope === 'clean_document') {
    cells.forEach((cell) => includedCellIds.add(cell.id));
  } else {
    operations
      .filter((operation) => operation.kind !== 'delete' && operation.cellKind === 'validation')
      .forEach((operation) => includedCellIds.add(operation.cellId));
  }
  const positionByCellId = new Map(cells.map((cell) => [cell.id, cell.position]));
  const cellIds = [...includedCellIds].sort(
    (left, right) => positionByCellId.get(left)! - positionByCellId.get(right)!,
  );
  const dependenciesByCellId = new Map(pythonPlan.dependenciesByCellId);
  cellIds.forEach((cellId) => {
    if (!dependenciesByCellId.has(cellId)) {
      dependenciesByCellId.set(cellId, []);
    }
  });
  return { cellIds, dependenciesByCellId };
}

async function finishCellChangeAttempt(attemptId: string, plannedCellCount: number): Promise<void> {
  const executions = await prisma.researchCellExecution.findMany({
    where: { cellChangeAttemptId: attemptId },
    orderBy: { startedAt: 'asc' },
    select: { status: true, error: true },
  });
  const cancelled = executions.some((execution) => execution.status === 'cancelled');
  const failed = executions.find((execution) => execution.status === 'error');
  const incomplete = executions.length < plannedCellCount;
  const status: ResearchCellChangeAttemptStatusV1 = cancelled
    ? 'cancelled'
    : failed || incomplete
      ? 'error'
      : 'success';
  const error = failed?.error ?? (incomplete ? 'upstream_cell_failed' : null);
  await prisma.researchCellChangeAttempt.update({
    where: { id: attemptId },
    data: { status, error, finishedAt: new Date() },
  });
}

function attemptErrorMessage(error: unknown): string {
  if (error instanceof ResearchDocumentContentRevisionConflictError) {
    return 'document_changed_during_run';
  }
  return error instanceof Error ? error.message : String(error);
}
