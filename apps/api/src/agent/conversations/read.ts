import type { ChatMessage } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';

export async function listConversations(
  userId: string,
  query: { surface?: 'strategy' | 'factor' | 'screen' | 'research'; entityId?: string },
) {
  const { surface, entityId } = query;
  const rows = await prisma.agentConversation.findMany({
    where: {
      userId: userId,
      archivedAt: null,
      ...(surface ? { surface } : {}),
      ...(surface === 'strategy' && entityId ? { strategyId: entityId } : {}),
      ...(surface === 'factor' && entityId ? { factorId: entityId } : {}),
    },
    select: { id: true, surface: true, title: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  return rows;
}

export async function listConversationMessages(
  userId: string,
  conversationId: string,
  query: { before?: number; limit: number },
) {
  const owner = await prisma.agentConversation.findFirst({
    where: { id: conversationId, userId: userId },
    select: { id: true },
  });
  if (!owner) {
    return null;
  }
  const { before, limit } = query;
  const rows = await prisma.agentMessage.findMany({
    where: { conversationId, ...(before !== undefined ? { sequence: { lt: before } } : {}) },
    orderBy: { sequence: 'desc' },
    take: limit,
  });
  const messages: ChatMessage[] = rows.reverse().map((row) => ({
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    parts: row.parts as unknown as ChatMessage['parts'],
    turnId: row.turnId ?? undefined,
    sequence: row.sequence,
    createdAt: row.createdAt.toISOString(),
  }));
  return { messages, nextBefore: messages[0]?.sequence };
}
