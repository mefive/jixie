import type { ChatMessage } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';

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
