import { prisma } from '../../infra/database/prisma.js';
import { closeResearchDocumentRuntime } from '../execution/python-session.js';

export async function listResearchConversations(userId: string) {
  const conversations = await prisma.agentConversation.findMany({
    where: { userId, surface: 'research', archivedAt: null },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { sequence: 'desc' },
        take: 1,
        select: { parts: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });
  return conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title ?? '',
    preview: messagePreview(conversation.messages[0]?.parts),
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  }));
}

export async function renameResearchConversation(
  userId: string,
  conversationId: string,
  title: string,
) {
  const updated = await prisma.agentConversation.updateMany({
    where: {
      id: conversationId,
      userId,
      surface: 'research',
      archivedAt: null,
    },
    data: { title },
  });
  return updated.count === 1;
}

export async function deleteResearchConversation(userId: string, conversationId: string) {
  const deleted = await prisma.agentConversation.deleteMany({
    where: { id: conversationId, userId, surface: 'research' },
  });
  if (deleted.count === 1) {
    closeResearchDocumentRuntime(conversationId);
  }
  return deleted.count === 1;
}

function messagePreview(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return '';
  }
  const text = parts.find(
    (part): part is { type: 'text'; text: string } =>
      typeof part === 'object' &&
      part !== null &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string',
  );
  if (text) {
    return text.text.slice(0, 80);
  }
  const artifact = parts.find(
    (part): part is { type: 'universe'; title: string } =>
      typeof part === 'object' &&
      part !== null &&
      (part as { type?: string }).type === 'universe' &&
      typeof (part as { title?: unknown }).title === 'string',
  );
  return artifact?.title.slice(0, 80) ?? '';
}
