import type { Prisma } from '@prisma/client';
import type {
  ResearchCellChangeConflictV1,
  ResearchCellChangeOperationV1,
  ResearchCellChangeProposalV1,
  ResearchCellChangeReviewResolutionResultV1,
  ResearchCellChangeResolutionResultV1,
  ResearchCellKindV1,
} from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '../lib/prisma.js';
import {
  researchCellChangeProposalView,
  resolveResearchCellChangeProposalRecord,
  syncResearchCellChangeProposalRecords,
} from './research-cell-change-records.js';
import { researchPlanSpecV1Schema } from './spec.js';
import {
  getResearchDocument,
  isResearchDocumentRunActive,
  reconcileResearchCellChanges,
  type ResearchCellChangeDependencySeed,
} from './workbench.js';
import { researchRuntimeManager } from './workbench-runtime.js';
import type { ResearchPythonAnalysis } from './workbench-runtime.js';

const MAX_PROPOSAL_OPERATIONS = 8;
const MAX_CELL_SOURCE_CHARACTERS = 100_000;
const MAX_PROPOSAL_SOURCE_CHARACTERS = 200_000;
const POSITION_OFFSET = 1_000_000;
const EXACT_LINE_DIFF_PRODUCT_LIMIT = 1_000_000;

export type ResearchCellChangeRequestOperation =
  | {
      kind: 'create';
      cellKind: ResearchCellKindV1;
      source: string;
      afterCellId?: string;
    }
  | {
      kind: 'update';
      cellId: string;
      expectedRevision: number;
      source: string;
    }
  | {
      kind: 'delete';
      cellId: string;
      expectedRevision: number;
    };

export interface ResearchCellChangeProposalRequest {
  title: string;
  summary: string;
  operations: ResearchCellChangeRequestOperation[];
}

interface CurrentResearchCell {
  id: string;
  position: number;
  kind: string;
  source: string;
  revision: number;
  definitions: Prisma.JsonValue;
  lastExecutedRevision: number | null;
}

interface ApplyTransactionResult {
  outcome: ResearchCellChangeResolutionResultV1['outcome'];
  proposal: ResearchCellChangeProposalV1;
  seeds: ResearchCellChangeDependencySeed[];
}

export type ResearchCellChangeReviewUnavailableReason =
  | 'delete_requires_explicit_application'
  | 'review_not_open'
  | 'review_already_open'
  | 'document_running'
  | 'document_changed';

export class ResearchCellChangeReviewUnavailableError extends Error {
  public constructor(readonly reason: ResearchCellChangeReviewUnavailableReason) {
    super(reason);
    this.name = 'ResearchCellChangeReviewUnavailableError';
  }
}

/** Build a read-only, revision-bound proposal from one Agent tool call. */
export async function prepareResearchCellChangeProposal(
  userId: string,
  documentId: string,
  request: ResearchCellChangeProposalRequest,
): Promise<ResearchCellChangeProposalV1> {
  if (request.operations.length === 0 || request.operations.length > MAX_PROPOSAL_OPERATIONS) {
    throw new Error(`A Cell change proposal requires 1-${MAX_PROPOSAL_OPERATIONS} operations.`);
  }
  const requestedSourceCharacters = request.operations.reduce(
    (total, operation) => total + ('source' in operation ? operation.source.length : 0),
    0,
  );
  if (requestedSourceCharacters > MAX_PROPOSAL_SOURCE_CHARACTERS) {
    throw new Error(
      `Proposed Cell sources require ${requestedSourceCharacters} characters; the proposal limit is ${MAX_PROPOSAL_SOURCE_CHARACTERS}.`,
    );
  }

  const document = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId },
    select: {
      id: true,
      updatedAt: true,
      contentRevision: true,
      cells: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          position: true,
          kind: true,
          source: true,
          revision: true,
          definitions: true,
          lastExecutedRevision: true,
        },
      },
    },
  });
  if (!document) {
    throw new Error('Research document not found.');
  }

  const cellById = new Map(document.cells.map((cell) => [cell.id, cell]));
  const targetedCellIds = new Set<string>();
  const deletedCellIds = new Set(
    request.operations
      .filter((operation) => operation.kind === 'delete')
      .map((operation) => operation.cellId),
  );
  const operations: ResearchCellChangeOperationV1[] = [];
  for (const requested of request.operations) {
    if (requested.kind === 'create') {
      validateCellSource(requested.cellKind, requested.source);
      if (requested.afterCellId) {
        if (!cellById.has(requested.afterCellId)) {
          throw new Error(`Create anchor Cell ${requested.afterCellId} was not found.`);
        }
        if (deletedCellIds.has(requested.afterCellId)) {
          throw new Error(
            `Create anchor Cell ${requested.afterCellId} is deleted by this proposal.`,
          );
        }
      }
      operations.push({
        operationId: ulid(),
        cellId: ulid(),
        kind: 'create',
        cellKind: requested.cellKind,
        position: document.cells.length,
        ...(requested.afterCellId ? { afterCellId: requested.afterCellId } : {}),
        beforeSource: '',
        afterSource: requested.source,
        addedLines: sourceLines(requested.source).length,
        removedLines: 0,
        afterDefinitions: [],
        afterReferences: [],
      });
      continue;
    }

    if (targetedCellIds.has(requested.cellId)) {
      throw new Error(`Cell ${requested.cellId} is changed more than once in one proposal.`);
    }
    targetedCellIds.add(requested.cellId);
    const current = cellById.get(requested.cellId);
    if (!current) {
      throw new Error(`Cell ${requested.cellId} was not found.`);
    }
    if (current.revision !== requested.expectedRevision) {
      throw new Error(
        `Cell ${requested.cellId} is at revision ${current.revision}, not ${requested.expectedRevision}.`,
      );
    }
    const cellKind = current.kind as ResearchCellKindV1;
    if (requested.kind === 'update') {
      validateCellSource(cellKind, requested.source);
      if (current.source === requested.source) {
        throw new Error(`Cell ${requested.cellId} source is unchanged.`);
      }
      const lineChanges = lineChangeCounts(current.source, requested.source);
      operations.push({
        operationId: ulid(),
        cellId: current.id,
        kind: 'update',
        cellKind,
        position: current.position,
        expectedRevision: current.revision,
        beforeSource: current.source,
        afterSource: requested.source,
        ...lineChanges,
        afterDefinitions: [],
        afterReferences: [],
      });
      continue;
    }
    operations.push({
      operationId: ulid(),
      cellId: current.id,
      kind: 'delete',
      cellKind,
      position: current.position,
      expectedRevision: current.revision,
      beforeSource: current.source,
      afterSource: '',
      addedLines: 0,
      removedLines: sourceLines(current.source).length,
      afterDefinitions: [],
      afterReferences: [],
    });
  }

  const finalCellIds = orderedCellIdsAfterChanges(
    document.cells.map((cell) => cell.id),
    operations,
  );
  const finalPositionByCellId = new Map(finalCellIds.map((cellId, position) => [cellId, position]));
  const positionedOperations = operations.map(
    (operation): ResearchCellChangeOperationV1 =>
      operation.kind === 'delete'
        ? operation
        : { ...operation, position: finalPositionByCellId.get(operation.cellId)! },
  );
  const analyses = await validateProposedDocument(
    document.id,
    document.cells,
    positionedOperations,
  );
  const analysisByCellId = new Map(analyses.map((analysis) => [analysis.cellId, analysis]));
  const analyzedOperations = positionedOperations.map((operation) => {
    if (operation.kind === 'delete' || operation.cellKind !== 'python') {
      return operation;
    }
    const analysis = analysisByCellId.get(operation.cellId);
    return {
      ...operation,
      afterDefinitions: analysis?.definitions ?? [],
      afterReferences: analysis?.references ?? [],
    };
  });

  const createdAt = new Date();
  return {
    version: 1,
    id: ulid(),
    documentId: document.id,
    title: request.title.trim().slice(0, 120),
    summary: request.summary.trim().slice(0, 1_000),
    status: 'pending',
    expectedDocumentUpdatedAt: document.updatedAt.toISOString(),
    expectedDocumentContentRevision: document.contentRevision,
    operations: analyzedOperations,
    createdAt: createdAt.toISOString(),
  };
}

export function applyResearchCellChangeProposal(
  userId: string,
  proposalId: string,
): Promise<ResearchCellChangeResolutionResultV1 | null> {
  return applyResearchCellChangeProposalInternal(userId, proposalId, false);
}

export function applyResearchCellChangeProposalForReview(
  userId: string,
  proposalId: string,
): Promise<ResearchCellChangeResolutionResultV1 | null> {
  return applyResearchCellChangeProposalInternal(userId, proposalId, true);
}

async function applyResearchCellChangeProposalInternal(
  userId: string,
  proposalId: string,
  openReview: boolean,
): Promise<ResearchCellChangeResolutionResultV1 | null> {
  const transactionResult = await prisma.$transaction(
    async (transaction): Promise<ApplyTransactionResult | null> => {
      const proposal = await transaction.researchCellChangeProposal.findFirst({
        where: { id: proposalId, document: { userId } },
        include: {
          document: {
            select: {
              id: true,
              updatedAt: true,
              contentRevision: true,
              cells: {
                orderBy: { position: 'asc' },
                select: {
                  id: true,
                  position: true,
                  kind: true,
                  source: true,
                  revision: true,
                  definitions: true,
                  lastExecutedRevision: true,
                },
              },
            },
          },
        },
      });
      if (!proposal) {
        return null;
      }
      if (proposal.status !== 'pending') {
        return {
          outcome: proposalOutcome(proposal.status),
          proposal: researchCellChangeProposalView(proposal),
          seeds: [],
        } satisfies ApplyTransactionResult;
      }

      const operations = proposal.operations as unknown as ResearchCellChangeOperationV1[];
      if (!openReview) {
        const activeReview = await transaction.researchCellChangeProposal.findFirst({
          where: { documentId: proposal.document.id, reviewStatus: 'open' },
          select: { id: true },
        });
        if (activeReview) {
          throw new ResearchCellChangeReviewUnavailableError('review_already_open');
        }
      }
      if (openReview && operations.some((operation) => operation.kind === 'delete')) {
        throw new ResearchCellChangeReviewUnavailableError('delete_requires_explicit_application');
      }
      const conflict = proposalConflict(
        proposal.document.contentRevision,
        proposal.expectedDocumentContentRevision,
        proposal.document.updatedAt,
        proposal.expectedDocumentUpdatedAt,
        proposal.document.cells,
        operations,
        isResearchDocumentRunActive(proposal.document.id),
      );
      const resolvedAt = new Date();
      if (conflict) {
        const conflicted = await resolveResearchCellChangeProposalRecord(transaction, {
          proposalId: proposal.id,
          status: 'conflicted',
          conflict,
          resolvedAt,
        });
        return { outcome: 'conflicted', proposal: conflicted, seeds: [] };
      }

      const result = await applyOperations(
        transaction,
        proposal.document.id,
        proposal.document.cells,
        operations,
        resolvedAt,
      );
      if (openReview) {
        const activeReview = await transaction.researchCellChangeProposal.findFirst({
          where: {
            documentId: proposal.document.id,
            reviewStatus: 'open',
            reviewSessionId: { not: null },
          },
          orderBy: [{ reviewSequence: 'desc' }, { createdAt: 'desc' }],
          select: { reviewSessionId: true, reviewSequence: true },
        });
        const reviewSessionId = activeReview?.reviewSessionId ?? ulid();
        const reviewSequence = (activeReview?.reviewSequence ?? 0) + 1;
        const previousReviewProposals = activeReview?.reviewSessionId
          ? await transaction.researchCellChangeProposal.findMany({
              where: {
                documentId: proposal.document.id,
                reviewSessionId: activeReview.reviewSessionId,
                reviewStatus: 'open',
              },
              select: { id: true },
            })
          : [];
        if (previousReviewProposals.length > 0) {
          await transaction.researchCellChangeProposal.updateMany({
            where: { id: { in: previousReviewProposals.map((candidate) => candidate.id) } },
            data: { reviewIsLatest: false },
          });
        }
        await transaction.researchCellChangeProposal.update({
          where: { id: proposal.id },
          data: {
            status: 'applied',
            appliedDocumentContentRevision: proposal.document.contentRevision + 1,
            resolvedAt,
            reviewSessionId,
            reviewSequence,
            reviewStatus: 'open',
            reviewIsLatest: true,
          },
        });
        const synced = await syncResearchCellChangeProposalRecords(transaction, [
          ...previousReviewProposals.map((candidate) => candidate.id),
          proposal.id,
        ]);
        return {
          outcome: 'applied',
          proposal: synced.find((candidate) => candidate.id === proposal.id)!,
          seeds: result.seeds,
        };
      }
      const applied = await resolveResearchCellChangeProposalRecord(transaction, {
        proposalId: proposal.id,
        status: 'applied',
        appliedDocumentContentRevision: proposal.document.contentRevision + 1,
        resolvedAt,
      });
      return { outcome: 'applied', proposal: applied, seeds: result.seeds };
    },
  );
  if (!transactionResult) {
    return null;
  }
  if (transactionResult.outcome === 'applied') {
    await reconcileResearchCellChanges(
      transactionResult.proposal.documentId,
      transactionResult.seeds,
    );
  }
  const document = await getResearchDocument(userId, transactionResult.proposal.documentId);
  if (!document) {
    return null;
  }
  return {
    version: 1,
    outcome: transactionResult.outcome,
    proposal: transactionResult.proposal,
    document,
  };
}

export async function rejectResearchCellChangeProposal(
  userId: string,
  proposalId: string,
): Promise<ResearchCellChangeResolutionResultV1 | null> {
  const transactionResult = await prisma.$transaction(async (transaction) => {
    const proposal = await transaction.researchCellChangeProposal.findFirst({
      where: { id: proposalId, document: { userId } },
    });
    if (!proposal) {
      return null;
    }
    if (proposal.status === 'applied' || proposal.status === 'rejected') {
      return {
        outcome: proposalOutcome(proposal.status),
        proposal: researchCellChangeProposalView(proposal),
      };
    }
    const rejected = await resolveResearchCellChangeProposalRecord(transaction, {
      proposalId: proposal.id,
      status: 'rejected',
      resolvedAt: new Date(),
    });
    return { outcome: 'rejected' as const, proposal: rejected };
  });
  if (!transactionResult) {
    return null;
  }
  const document = await getResearchDocument(userId, transactionResult.proposal.documentId);
  return document ? { version: 1, ...transactionResult, document } : null;
}

export async function acceptResearchCellChangeReview(
  userId: string,
  proposalId: string,
  expectedContentRevision: number,
): Promise<ResearchCellChangeReviewResolutionResultV1 | null> {
  const documentId = await prisma.$transaction(async (transaction) => {
    const proposal = await transaction.researchCellChangeProposal.findFirst({
      where: { id: proposalId, document: { userId } },
      include: { document: { select: { id: true, contentRevision: true } } },
    });
    if (!proposal) {
      return null;
    }
    if (!proposal.reviewSessionId || proposal.reviewStatus !== 'open') {
      throw new ResearchCellChangeReviewUnavailableError('review_not_open');
    }
    if (isResearchDocumentRunActive(proposal.documentId)) {
      throw new ResearchCellChangeReviewUnavailableError('document_running');
    }
    if (proposal.document.contentRevision !== expectedContentRevision) {
      throw new ResearchCellChangeReviewUnavailableError('document_changed');
    }

    const reviewProposals = await transaction.researchCellChangeProposal.findMany({
      where: {
        documentId: proposal.documentId,
        reviewSessionId: proposal.reviewSessionId,
        reviewStatus: 'open',
      },
      select: { id: true },
    });
    const resolvedAt = new Date();
    await transaction.researchCellChangeProposal.updateMany({
      where: { id: { in: reviewProposals.map((candidate) => candidate.id) } },
      data: {
        reviewStatus: 'accepted',
        reviewResolvedAt: resolvedAt,
        appliedDocumentContentRevision: proposal.document.contentRevision,
      },
    });
    await syncResearchCellChangeProposalRecords(
      transaction,
      reviewProposals.map((candidate) => candidate.id),
    );
    return proposal.document.id;
  });
  if (!documentId) {
    return null;
  }
  const document = await getResearchDocument(userId, documentId);
  return document ? { version: 1, outcome: 'accepted', document } : null;
}

export async function revertResearchCellChangeReview(
  userId: string,
  proposalId: string,
  expectedContentRevision: number,
): Promise<ResearchCellChangeReviewResolutionResultV1 | null> {
  const transactionResult = await prisma.$transaction(async (transaction) => {
    const proposal = await transaction.researchCellChangeProposal.findFirst({
      where: { id: proposalId, document: { userId } },
      include: {
        document: {
          select: {
            id: true,
            contentRevision: true,
            cells: {
              orderBy: { position: 'asc' },
              select: {
                id: true,
                position: true,
                kind: true,
                source: true,
                revision: true,
                definitions: true,
                lastExecutedRevision: true,
              },
            },
          },
        },
      },
    });
    if (!proposal) {
      return null;
    }
    if (!proposal.reviewSessionId || proposal.reviewStatus !== 'open') {
      throw new ResearchCellChangeReviewUnavailableError('review_not_open');
    }
    if (isResearchDocumentRunActive(proposal.documentId)) {
      throw new ResearchCellChangeReviewUnavailableError('document_running');
    }
    if (proposal.document.contentRevision !== expectedContentRevision) {
      throw new ResearchCellChangeReviewUnavailableError('document_changed');
    }

    const reviewProposals = await transaction.researchCellChangeProposal.findMany({
      where: {
        documentId: proposal.documentId,
        reviewSessionId: proposal.reviewSessionId,
        reviewStatus: 'open',
      },
      orderBy: { reviewSequence: 'asc' },
    });
    const firstOperationByCellId = new Map<string, ResearchCellChangeOperationV1>();
    for (const reviewProposal of reviewProposals) {
      const operations = reviewProposal.operations as unknown as ResearchCellChangeOperationV1[];
      for (const operation of operations) {
        if (operation.kind === 'delete') {
          throw new ResearchCellChangeReviewUnavailableError('review_not_open');
        }
        if (!firstOperationByCellId.has(operation.cellId)) {
          firstOperationByCellId.set(operation.cellId, operation);
        }
      }
    }

    const currentByCellId = new Map(
      proposal.document.cells.map((cell) => [cell.id, cell] as const),
    );
    const reverseOperations: ResearchCellChangeOperationV1[] = [];
    for (const operation of firstOperationByCellId.values()) {
      const current = currentByCellId.get(operation.cellId);
      if (!current) {
        throw new ResearchCellChangeReviewUnavailableError('document_changed');
      }
      if (operation.kind === 'create') {
        reverseOperations.push({
          operationId: ulid(),
          cellId: current.id,
          kind: 'delete',
          cellKind: operation.cellKind,
          position: current.position,
          expectedRevision: current.revision,
          beforeSource: current.source,
          afterSource: '',
          addedLines: 0,
          removedLines: sourceLines(current.source).length,
          afterDefinitions: [],
          afterReferences: [],
        });
        continue;
      }
      const lineChanges = lineChangeCounts(current.source, operation.beforeSource);
      reverseOperations.push({
        operationId: ulid(),
        cellId: current.id,
        kind: 'update',
        cellKind: operation.cellKind,
        position: current.position,
        expectedRevision: current.revision,
        beforeSource: current.source,
        afterSource: operation.beforeSource,
        ...lineChanges,
        afterDefinitions: [],
        afterReferences: [],
      });
    }

    const analyses = await validateProposedDocument(
      proposal.document.id,
      proposal.document.cells,
      reverseOperations,
    );
    const analysisByCellId = new Map(analyses.map((analysis) => [analysis.cellId, analysis]));
    const analyzedReverseOperations = reverseOperations.map((operation) => {
      if (operation.kind === 'delete' || operation.cellKind !== 'python') {
        return operation;
      }
      const analysis = analysisByCellId.get(operation.cellId);
      return {
        ...operation,
        afterDefinitions: analysis?.definitions ?? [],
        afterReferences: analysis?.references ?? [],
      };
    });
    const result = await applyOperations(
      transaction,
      proposal.document.id,
      proposal.document.cells,
      analyzedReverseOperations,
      new Date(),
    );
    const resolvedAt = new Date();
    await transaction.researchCellChangeProposal.updateMany({
      where: { id: { in: reviewProposals.map((candidate) => candidate.id) } },
      data: { reviewStatus: 'reverted', reviewResolvedAt: resolvedAt },
    });
    await syncResearchCellChangeProposalRecords(
      transaction,
      reviewProposals.map((candidate) => candidate.id),
    );
    return { documentId: proposal.document.id, seeds: result.seeds };
  });
  if (!transactionResult) {
    return null;
  }
  await reconcileResearchCellChanges(transactionResult.documentId, transactionResult.seeds);
  const document = await getResearchDocument(userId, transactionResult.documentId);
  return document ? { version: 1, outcome: 'reverted', document } : null;
}

async function applyOperations(
  transaction: Prisma.TransactionClient,
  documentId: string,
  currentCells: CurrentResearchCell[],
  operations: ResearchCellChangeOperationV1[],
  appliedAt: Date,
): Promise<{ seeds: ResearchCellChangeDependencySeed[] }> {
  const currentByCellId = new Map(currentCells.map((cell) => [cell.id, cell]));
  const operationByCellId = new Map(operations.map((operation) => [operation.cellId, operation]));
  const finalCellIds = orderedCellIdsAfterChanges(
    currentCells.map((cell) => cell.id),
    operations,
  );
  const deletedCellIds = operations
    .filter((operation) => operation.kind === 'delete')
    .map((operation) => operation.cellId);
  const seeds: ResearchCellChangeDependencySeed[] = operations.map((operation) => ({
    cellId: operation.cellId,
    previousDefinitions:
      operation.kind === 'create'
        ? []
        : jsonStringArray(currentByCellId.get(operation.cellId)?.definitions),
  }));

  await transaction.researchCell.updateMany({
    where: { documentId },
    data: { position: { increment: POSITION_OFFSET } },
  });
  if (deletedCellIds.length > 0) {
    await transaction.researchCell.deleteMany({
      where: { documentId, id: { in: deletedCellIds } },
    });
  }
  for (const [position, cellId] of finalCellIds.entries()) {
    const current = currentByCellId.get(cellId);
    const operation = operationByCellId.get(cellId);
    if (!current) {
      continue;
    }
    await transaction.researchCell.update({
      where: { id: cellId },
      data: {
        position,
        ...(operation?.kind === 'update'
          ? {
              source: operation.afterSource,
              revision: { increment: 1 },
              status: current.lastExecutedRevision == null ? 'idle' : 'stale',
              definitions: operation.afterDefinitions as unknown as Prisma.InputJsonValue,
              references: operation.afterReferences as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
  }
  const created = operations.filter((operation) => operation.kind === 'create');
  if (created.length > 0) {
    await transaction.researchCell.createMany({
      data: created.map((operation) => ({
        id: operation.cellId,
        documentId,
        position: finalCellIds.indexOf(operation.cellId),
        kind: operation.cellKind,
        source: operation.afterSource,
        definitions: operation.afterDefinitions as unknown as Prisma.InputJsonValue,
        references: operation.afterReferences as unknown as Prisma.InputJsonValue,
      })),
    });
  }
  await transaction.researchDocument.update({
    where: { id: documentId },
    data: { updatedAt: appliedAt, contentRevision: { increment: 1 } },
  });
  return { seeds };
}

async function validateProposedDocument(
  documentId: string,
  currentCells: CurrentResearchCell[],
  operations: ResearchCellChangeOperationV1[],
): Promise<ResearchPythonAnalysis[]> {
  const operationByCellId = new Map(operations.map((operation) => [operation.cellId, operation]));
  const finalCellIds = orderedCellIdsAfterChanges(
    currentCells.map((cell) => cell.id),
    operations,
  );
  const finalCells = finalCellIds.map((cellId) => {
    const operation = operationByCellId.get(cellId);
    const current = currentCells.find((cell) => cell.id === cellId);
    return {
      id: cellId,
      kind: operation?.cellKind ?? current!.kind,
      source:
        operation?.kind === 'create' || operation?.kind === 'update'
          ? operation.afterSource
          : current!.source,
    };
  });
  const pythonCells = finalCells
    .filter((cell) => cell.kind === 'python')
    .map((cell) => ({ id: cell.id, source: cell.source }));
  const analyses =
    pythonCells.length > 0 ? await researchRuntimeManager.analyze(documentId, pythonCells) : [];
  const syntaxError = analyses.find((analysis) => analysis.error);
  if (syntaxError) {
    throw new Error(`Cell ${syntaxError.cellId} is invalid Python: ${syntaxError.error}`);
  }

  const definitionsByName = new Map<string, string[]>();
  for (const analysis of analyses) {
    for (const definition of analysis.definitions) {
      definitionsByName.set(definition, [
        ...(definitionsByName.get(definition) ?? []),
        analysis.cellId,
      ]);
    }
  }
  const duplicate = [...definitionsByName].find(([, cellIds]) => cellIds.length > 1);
  if (duplicate) {
    throw new Error(
      `Variable ${duplicate[0]} is defined by multiple Cells: ${duplicate[1].join(', ')}.`,
    );
  }
  if (hasDependencyCycle(analyses, definitionsByName)) {
    throw new Error('The proposed Cells create a cyclic dependency.');
  }
  return analyses;
}

function hasDependencyCycle(
  analyses: Array<{ cellId: string; definitions: string[]; references: string[] }>,
  definitionsByName: Map<string, string[]>,
): boolean {
  const dependencies = new Map<string, Set<string>>(
    analyses.map((analysis) => [analysis.cellId, new Set<string>()]),
  );
  for (const analysis of analyses) {
    for (const reference of analysis.references) {
      const owner = definitionsByName.get(reference)?.[0];
      if (owner && owner !== analysis.cellId) {
        dependencies.get(analysis.cellId)!.add(owner);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (cellId: string): boolean => {
    if (visiting.has(cellId)) {
      return true;
    }
    if (visited.has(cellId)) {
      return false;
    }
    visiting.add(cellId);
    for (const dependency of dependencies.get(cellId) ?? []) {
      if (visit(dependency)) {
        return true;
      }
    }
    visiting.delete(cellId);
    visited.add(cellId);
    return false;
  };
  return analyses.some((analysis) => visit(analysis.cellId));
}

function proposalConflict(
  documentContentRevision: number,
  expectedDocumentContentRevision: number | null,
  documentUpdatedAt: Date,
  expectedDocumentUpdatedAt: Date,
  currentCells: CurrentResearchCell[],
  operations: ResearchCellChangeOperationV1[],
  documentRunning: boolean,
): ResearchCellChangeConflictV1 | null {
  if (documentRunning) {
    return { reason: 'document_running', cellIds: [] };
  }
  const currentByCellId = new Map(currentCells.map((cell) => [cell.id, cell]));
  const existingOperations = operations.filter((operation) => operation.kind !== 'create');
  const missingCellIds = existingOperations
    .filter((operation) => !currentByCellId.has(operation.cellId))
    .map((operation) => operation.cellId);
  if (missingCellIds.length > 0) {
    return { reason: 'cell_missing', cellIds: missingCellIds };
  }
  const changedRevisionCellIds = existingOperations
    .filter(
      (operation) => currentByCellId.get(operation.cellId)!.revision !== operation.expectedRevision,
    )
    .map((operation) => operation.cellId);
  if (changedRevisionCellIds.length > 0) {
    return { reason: 'cell_revision_changed', cellIds: changedRevisionCellIds };
  }
  const changedSourceCellIds = existingOperations
    .filter((operation) => currentByCellId.get(operation.cellId)!.source !== operation.beforeSource)
    .map((operation) => operation.cellId);
  if (changedSourceCellIds.length > 0) {
    return { reason: 'cell_source_changed', cellIds: changedSourceCellIds };
  }
  const documentChanged =
    expectedDocumentContentRevision == null
      ? documentUpdatedAt.getTime() !== expectedDocumentUpdatedAt.getTime()
      : documentContentRevision !== expectedDocumentContentRevision;
  if (documentChanged) {
    return { reason: 'document_changed', cellIds: [] };
  }
  return null;
}

function orderedCellIdsAfterChanges(
  currentCellIds: string[],
  operations: ResearchCellChangeOperationV1[],
): string[] {
  const deletedCellIds = new Set(
    operations
      .filter((operation) => operation.kind === 'delete')
      .map((operation) => operation.cellId),
  );
  const orderedCellIds = currentCellIds.filter((cellId) => !deletedCellIds.has(cellId));
  const lastInsertedByAnchor = new Map<string, string>();
  for (const operation of operations) {
    if (operation.kind !== 'create') {
      continue;
    }
    if (!operation.afterCellId) {
      orderedCellIds.push(operation.cellId);
      continue;
    }
    const effectiveAnchor =
      lastInsertedByAnchor.get(operation.afterCellId) ?? operation.afterCellId;
    const anchorIndex = orderedCellIds.indexOf(effectiveAnchor);
    if (anchorIndex < 0) {
      throw new Error(`Create anchor Cell ${operation.afterCellId} is unavailable.`);
    }
    orderedCellIds.splice(anchorIndex + 1, 0, operation.cellId);
    lastInsertedByAnchor.set(operation.afterCellId, operation.cellId);
  }
  return orderedCellIds;
}

function validateCellSource(kind: ResearchCellKindV1, source: string): void {
  if (source.length > MAX_CELL_SOURCE_CHARACTERS) {
    throw new Error(
      `Cell source requires ${source.length} characters; the limit is ${MAX_CELL_SOURCE_CHARACTERS}.`,
    );
  }
  if (kind !== 'validation') {
    return;
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `Validation Cell JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  researchPlanSpecV1Schema.parse(value);
}

function lineChangeCounts(
  beforeSource: string,
  afterSource: string,
): { addedLines: number; removedLines: number } {
  const before = sourceLines(beforeSource);
  const after = sourceLines(afterSource);
  if (before.length * after.length > EXACT_LINE_DIFF_PRODUCT_LIMIT) {
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < before.length - prefix &&
      suffix < after.length - prefix &&
      before[before.length - suffix - 1] === after[after.length - suffix - 1]
    ) {
      suffix += 1;
    }
    return {
      addedLines: after.length - prefix - suffix,
      removedLines: before.length - prefix - suffix,
    };
  }

  let previous = new Array<number>(after.length + 1).fill(0);
  for (const beforeLine of before) {
    const current = new Array<number>(after.length + 1).fill(0);
    for (let afterIndex = 0; afterIndex < after.length; afterIndex += 1) {
      current[afterIndex + 1] =
        beforeLine === after[afterIndex]
          ? previous[afterIndex] + 1
          : Math.max(previous[afterIndex + 1], current[afterIndex]);
    }
    previous = current;
  }
  const unchangedLines = previous[after.length];
  return {
    addedLines: after.length - unchangedLines,
    removedLines: before.length - unchangedLines,
  };
}

function sourceLines(source: string): string[] {
  return source.length === 0 ? [] : source.replace(/\r\n/g, '\n').split('\n');
}

function jsonStringArray(value: Prisma.JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function proposalOutcome(status: string): ResearchCellChangeResolutionResultV1['outcome'] {
  switch (status) {
    case 'applied':
      return 'applied';
    case 'rejected':
      return 'rejected';
    case 'conflicted':
    default:
      return 'conflicted';
  }
}
