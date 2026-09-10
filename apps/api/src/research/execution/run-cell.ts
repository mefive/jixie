import type { ResearchDocumentV1, ResearchCellOutputBlockV1 } from '@jixie/shared';
import {
  loadExecutableResearchCell,
  type ExecutableResearchCellRow,
} from '../documents/execution-source.js';
import { assertNoOpenCellChangeReview } from '../proposals/review-state.js';
import { assertResearchCellsRunnable } from '../dependencies/runnable.js';
import {
  startResearchDocumentRun,
  finishResearchDocumentRun,
  type ResearchDocumentRunControl,
} from './run-state.js';
import { getResearchDocument } from '../documents/read.js';
import { ulid } from 'ulid';
import { prisma } from '#infra/database/prisma.js';
import type { Prisma } from '@prisma/client';
import { materializeResearchOutputArtifacts } from '../evidence/artifacts.js';
import {
  ResearchPythonExecutionError,
  ResearchPythonInterruptionError,
  researchRuntimeManager,
} from './python-session.js';
import { researchPayloadHash } from '../evidence/fingerprints.js';

export type ResearchCellExecutionOutcome = 'success' | 'error' | 'interrupted';

export async function runResearchCell(
  userId: string,
  cellId: string,
): Promise<ResearchDocumentV1 | null> {
  const cell = await loadExecutableResearchCell(userId, cellId);
  if (!cell) {
    return null;
  }
  await assertNoOpenCellChangeReview(cell.documentId);
  assertResearchCellsRunnable([cell]);
  const control = startResearchDocumentRun(cell.documentId);
  try {
    await executeResearchCell(cell, control);
    return getResearchDocument(userId, cell.documentId);
  } finally {
    finishResearchDocumentRun(control);
  }
}

export async function executeResearchCellById(
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

export async function executeResearchCell(
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
