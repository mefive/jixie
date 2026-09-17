import { prisma } from '#infra/database/prisma.js';
import type { ResearchDocumentRunResultV1 } from '@jixie/shared';
import { analyzeAndPersist } from '../dependencies/analyze.js';
import { affectedResearchCellRunPlan } from '../dependencies/run-plan.js';
import { assertResearchCellIdsRunnable } from '../dependencies/runnable.js';
import { ResearchError } from '../errors.js';
import { assertNoOpenCellChangeReview } from '../proposals/review-state.js';
import { executeAffectedResearchCellPlan } from './execute-plan.js';
import { executeResearchCellById } from './run-cell.js';
import { researchDocumentRunResult } from './run-result.js';
import { finishResearchDocumentRun, startResearchDocumentRun } from './run-state.js';

export async function runAffectedResearchCells(
  userId: string,
  cellId: string,
): Promise<ResearchDocumentRunResultV1> {
  const cell = await prisma.researchCell.findFirst({
    where: { id: cellId, document: { userId, embeddedVersion: null } },
    select: { id: true, documentId: true },
  });
  if (!cell) {
    throw new ResearchError('document_not_found');
  }
  await assertNoOpenCellChangeReview(cell.documentId);
  const control = startResearchDocumentRun(cell.documentId);
  try {
    const analyses = await analyzeAndPersist(cell.documentId);
    const plan = affectedResearchCellRunPlan(cell.id, analyses);
    await assertResearchCellIdsRunnable(cell.documentId, plan.cellIds);
    if (control.interrupted) {
      return researchDocumentRunResult(userId, cell.documentId, [], false);
    }

    const downstreamCellIds = plan.cellIds.filter((affectedCellId) => affectedCellId !== cell.id);
    if (downstreamCellIds.length > 0) {
      await prisma.researchCell.updateMany({
        where: {
          documentId: cell.documentId,
          id: { in: downstreamCellIds },
          status: { not: 'blocked' },
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
