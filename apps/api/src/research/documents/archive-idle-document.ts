import { prisma } from '../../infra/database/prisma.js';
import { entityKey } from '../../agent/turn-run.js';
import * as turnBus from '../../agent/turn-bus.js';
import {
  isResearchDocumentRunActive,
  ResearchDocumentRunInProgressError,
} from '../execution/run-state.js';
import { archiveResearchDocument } from './document-operations.js';

export async function archiveIdleResearchDocument(userId: string, documentId: string) {
  const owner = await prisma.agentConversation.findFirst({
    where: { id: documentId, userId, surface: 'research' },
    select: { id: true },
  });
  if (!owner) {
    return false;
  }

  if (
    isResearchDocumentRunActive(documentId) ||
    turnBus.findRunning(entityKey({ kind: 'research', id: documentId }), userId)
  ) {
    throw new ResearchDocumentRunInProgressError();
  }

  return archiveResearchDocument(userId, documentId);
}
