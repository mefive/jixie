import { researchSandboxPool } from '../sandbox/research-sandbox-pool.js';
import { prisma } from '#infra/database/prisma.js';
import type { ResearchDocumentInterruptResultV1, ResearchDocumentV1 } from '@jixie/shared';
import { getResearchDocument } from '../documents/read.js';
import { ResearchError } from '../errors.js';
import { assertNoOpenCellChangeReview } from '../proposals/review-state.js';

import { getResearchDocumentRun } from './run-state.js';

/**
 * 标记文档运行中断并取消活动 Cell，供用户停止执行。
 *
 * Interrupt the document run and cancel its active cell.
 */
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
  researchSandboxPool.interrupt(documentId);
  await control.settled;
  return {
    version: 1,
    document: (await getResearchDocument(userId, documentId))!,
    interrupted: true,
  };
}

/**
 * 验证文档归属和活动运行后重置 Python 会话，并使旧输出失效。
 *
 * Authorize and reset a document sandbox and invalidate prior outputs.
 */
export async function resetResearchDocumentSandbox(
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
  await researchSandboxPool.reset(documentId);
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
