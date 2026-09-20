import { prisma } from '#infra/database/prisma.js';
import type { ResearchDocumentRunResultV1 } from '@jixie/shared';
import { analyzeAndPersist } from '../dependencies/analyze.js';
import { assertResearchCellsRunnable } from '../dependencies/runnable.js';
import {
  loadResearchExecutionSeed,
  researchExecutionSourceCellSnapshot,
} from '../documents/execution-source.js';
import { getResearchDocument } from '../documents/read.js';
import { ResearchError } from '../errors.js';
import { createResearchExecution, finishResearchExecution } from '../evidence/execution-records.js';
import { assertNoOpenCellChangeReview } from '../proposals/review-state.js';
import { researchRuntimeManager } from '../runtime/python/session.js';
import {
  type ResearchCellExecutionOutcome,
  executeResearchCell,
  executeResearchCellById,
} from './run-cell.js';
import { researchDocumentRunResult } from './run-result.js';
import { finishResearchDocumentRun, startResearchDocumentRun } from './run-state.js';

export async function runResearchDocument(
  userId: string,
  documentId: string,
  clean: boolean,
): Promise<ResearchDocumentRunResultV1> {
  const owner = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId, embeddedVersion: null },
    select: { id: true },
  });
  if (!owner) {
    throw new ResearchError('document_not_found');
  }
  await assertNoOpenCellChangeReview(documentId);
  const control = startResearchDocumentRun(documentId);
  let researchExecutionId: string | undefined;
  try {
    if (clean) {
      await analyzeAndPersist(documentId);
      const frozen = await loadResearchExecutionSeed(userId, documentId);
      if (!frozen) {
        throw new ResearchError('document_not_found');
      }
      assertResearchCellsRunnable(frozen.cells);
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
          where: {
            documentId,
            kind: 'python',
            status: { not: 'blocked' },
            lastExecutedRevision: { not: null },
          },
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

    assertResearchCellsRunnable(document.cells);
    const executedCellIds: string[] = [];
    for (const cell of document.cells) {
      if (control.interrupted) {
        break;
      }
      const outcome = await executeResearchCellById(userId, cell.id, control);
      if (!outcome) {
        throw new ResearchError('document_not_found');
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
