import { researchRuntimePool } from '../runtime/pool.js';
import { prisma } from '#infra/database/prisma.js';
import type { ResearchDocumentInterruptResultV1, ResearchDocumentV1 } from '@jixie/shared';
import { getResearchDocument } from '../documents/read.js';
import { ResearchError } from '../errors.js';
import { assertNoOpenCellChangeReview } from '../proposals/review-state.js';

import { getResearchDocumentRun } from './run-state.js';

export async function interruptResearchDocument(
  userId: string,
  documentId: string,
): Promise<ResearchDocumentInterruptResultV1> {
  const owner = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId, embeddedVersion: null },
    select: { id: true },
  });
  if (!owner) {
    throw new ResearchError('document_not_found');
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
  researchRuntimePool.interrupt(documentId);
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
): Promise<ResearchDocumentV1> {
  const owner = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId, embeddedVersion: null },
    select: { id: true },
  });
  if (!owner) {
    throw new ResearchError('document_not_found');
  }
  await assertNoOpenCellChangeReview(documentId);
  await researchRuntimePool.reset(documentId);
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
