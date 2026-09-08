import type {
  ResearchDocumentListStateV1,
  ResearchDocumentSummaryV1,
  ResearchDocumentTemplateV1,
  ResearchDocumentV1,
} from '@jixie/shared';
import { prisma } from '../../infra/database/prisma.js';
import { closeResearchDocumentRuntime } from '../execution/python-session.js';
import { ulid } from 'ulid';
import { templateDefinition } from './templates.js';
import { cellCreate } from './cell-seed.js';
import { getResearchDocument } from './read.js';
import type { Prisma } from '@prisma/client';

export async function listResearchDocuments(
  userId: string,
  state: ResearchDocumentListStateV1 = 'active',
): Promise<ResearchDocumentSummaryV1[]> {
  const conversations = await prisma.agentConversation.findMany({
    where: {
      userId,
      surface: 'research',
      archivedAt: state === 'archived' ? { not: null } : null,
    },
    include: {
      researchDocument: {
        select: { cells: { select: { status: true } } },
      },
      messages: {
        orderBy: { sequence: 'desc' },
        take: 1,
        select: { parts: true },
      },
    },
    orderBy: state === 'archived' ? { archivedAt: 'desc' } : { updatedAt: 'desc' },
  });
  return conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title ?? '',
    preview: messagePreview(conversation.messages[0]?.parts),
    cellCount: conversation.researchDocument?.cells.length ?? 0,
    staleCount:
      conversation.researchDocument?.cells.filter((cell) => cell.status === 'stale').length ?? 0,
    blockedCount:
      conversation.researchDocument?.cells.filter((cell) => cell.status === 'blocked').length ?? 0,
    archivedAt: conversation.archivedAt?.toISOString() ?? null,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  }));
}

export async function archiveResearchDocument(
  userId: string,
  documentId: string,
): Promise<boolean> {
  const conversation = await prisma.agentConversation.findFirst({
    where: { id: documentId, userId, surface: 'research' },
    select: { id: true, archivedAt: true },
  });
  if (!conversation) {
    return false;
  }
  if (!conversation.archivedAt) {
    await prisma.agentConversation.update({
      where: { id: conversation.id },
      data: { archivedAt: new Date() },
    });
  }
  closeResearchDocumentRuntime(documentId);
  return true;
}

export async function restoreResearchDocument(
  userId: string,
  documentId: string,
): Promise<boolean> {
  const conversation = await prisma.agentConversation.findFirst({
    where: { id: documentId, userId, surface: 'research' },
    select: { id: true, archivedAt: true },
  });
  if (!conversation) {
    return false;
  }
  if (conversation.archivedAt) {
    await prisma.agentConversation.update({
      where: { id: conversation.id },
      data: { archivedAt: null },
    });
  }
  return true;
}

export async function createResearchDocument(
  userId: string,
  template: ResearchDocumentTemplateV1,
): Promise<ResearchDocumentV1> {
  const id = ulid();
  const definition = templateDefinition(template);
  await prisma.$transaction(async (transaction) => {
    await transaction.agentConversation.create({
      data: { id, userId, surface: 'research', title: definition.title },
    });
    await transaction.researchDocument.create({
      data: {
        id,
        userId,
        conversationId: id,
        cells: {
          create: definition.cells.map((cell, position) => cellCreate(cell, position)),
        },
      },
    });
  });
  return (await getResearchDocument(userId, id))!;
}

function messagePreview(parts: Prisma.JsonValue | undefined): string {
  if (!Array.isArray(parts)) {
    return '';
  }
  for (const part of parts) {
    if (typeof part === 'object' && part !== null && !Array.isArray(part)) {
      if (part.type === 'text' && typeof part.text === 'string') {
        return part.text.slice(0, 80);
      }
      if (
        (part.type === 'research' || part.type === 'universe') &&
        typeof part.title === 'string'
      ) {
        return part.title.slice(0, 80);
      }
    }
  }
  return '';
}
