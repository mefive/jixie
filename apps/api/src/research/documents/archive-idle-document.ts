import * as turnBus from '#agent/turns/bus.js';
import { entityKey } from '#agent/turns/run.js';
import { prisma } from '#infra/database/prisma.js';
import { isResearchDocumentRunActive } from '../document-runs/run-state.js';
import { ResearchError } from '../errors.js';
import { archiveResearchDocument } from './document-operations.js';

/**
 * 仅在文档空闲时归档，避免与活动编辑或运行竞争。
 * Archive an idle document without racing active work.
 */
export async function archiveIdleResearchDocument(userId: string, documentId: string) {
  const owner = await prisma.agentConversation.findFirst({
    where: { id: documentId, userId, surface: 'research' },
    select: { id: true },
  });
  if (!owner) {
    throw new ResearchError('document_not_found');
  }

  if (
    isResearchDocumentRunActive(documentId) ||
    turnBus.findRunning(entityKey({ kind: 'research', id: documentId }), userId)
  ) {
    throw new ResearchError('document_run_in_progress');
  }

  return archiveResearchDocument(userId, documentId);
}
