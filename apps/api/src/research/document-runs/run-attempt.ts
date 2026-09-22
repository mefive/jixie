import { researchRuntimePool } from '../runtime/pool.js';
import { prisma } from '#infra/database/prisma.js';
import type { ResearchDocumentRunResultV1 } from '@jixie/shared';
import type { ResearchAffectedRunPlan } from '../dependencies/run-plan.js';
import { assertResearchCellIdsRunnable } from '../dependencies/runnable.js';
import { ResearchError } from '../errors.js';

import { executeAffectedResearchCellPlan } from './execute-plan.js';
import { finishResearchDocumentRun, startResearchDocumentRun } from './run-state.js';

import { executeResearchCellById } from './run-cell.js';
import { researchDocumentRunResult } from './run-result.js';

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
): Promise<ResearchDocumentRunResultV1> {
  const document = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId, embeddedVersion: null },
    select: { id: true },
  });
  if (!document) {
    throw new ResearchError('document_not_found');
  }

  const control = startResearchDocumentRun(documentId);
  try {
    await assertResearchCellIdsRunnable(documentId, plan.cellIds);
    if (args.clean) {
      await researchRuntimePool.reset(documentId);
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
    }

    const executedCellIds = await executeAffectedResearchCellPlan(
      plan,
      async (cellId) => {
        const current = await prisma.researchDocument.findUnique({
          where: { id: documentId },
          select: { contentRevision: true },
        });
        if (!current || current.contentRevision !== args.expectedContentRevision) {
          throw new ResearchError('document_revision_conflict', {
            details: {
              currentContentRevision: current?.contentRevision ?? args.expectedContentRevision,
            },
          });
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
      throw new ResearchError('document_revision_conflict', {
        details: {
          currentContentRevision: finalDocument?.contentRevision ?? args.expectedContentRevision,
        },
      });
    }
    return researchDocumentRunResult(userId, documentId, executedCellIds, args.clean);
  } finally {
    finishResearchDocumentRun(control);
  }
}
