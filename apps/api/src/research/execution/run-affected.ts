import type { ResearchDocumentRunResultV1 } from '@jixie/shared';
import { prisma } from '../../infra/database/prisma.js';
import { assertNoOpenCellChangeReview } from '../proposals/review-state.js';
import { startResearchDocumentRun, finishResearchDocumentRun } from './run-state.js';
import { analyzeAndPersist } from '../dependencies/analyze.js';
import { affectedResearchCellRunPlan } from '../dependencies/run-plan.js';
import { assertResearchCellIdsRunnable } from '../dependencies/runnable.js';
import { researchDocumentRunResult } from './run-result.js';
import { executeAffectedResearchCellPlan } from './execute-plan.js';
import { executeResearchCellById } from './run-cell.js';

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
