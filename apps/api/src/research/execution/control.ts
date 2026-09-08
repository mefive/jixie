import type { ResearchDocumentInterruptResultV1, ResearchDocumentV1 } from '@jixie/shared';
import { prisma } from '../../infra/database/prisma.js';
import { getResearchDocumentRun } from './run-state.js';
import { getResearchDocument } from '../documents/read.js';
import { researchRuntimeManager } from './python-session.js';
import { assertNoOpenCellChangeReview } from '../proposals/review-state.js';

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

  const control = getResearchDocumentRun(documentId);
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
    where: {
      documentId,
      kind: 'python',
      status: { not: 'blocked' },
      lastExecutedRevision: { not: null },
    },
    data: { status: 'stale' },
  });
  return getResearchDocument(userId, documentId);
}
