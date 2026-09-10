import type { Prisma } from '@prisma/client';
import type { ChatMessage } from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '#infra/database/prisma.js';
import type { TurnEntity } from '../turns/run.js';

export async function findOrCreateConversation(args: {
  userId: string;
  entity: TurnEntity;
  history: ChatMessage[];
  message: string;
}): Promise<{ id: string }> {
  if (args.entity.kind === 'research') {
    const conversation = await prisma.agentConversation.findFirst({
      where: {
        id: args.entity.id,
        userId: args.userId,
        surface: 'research',
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!conversation) {
      throw new Error('Research conversation not found.');
    }
    return conversation;
  }
  const relation =
    args.entity.kind === 'strategy' ? { strategyId: args.entity.id } : { factorId: args.entity.id };
  const existing = await prisma.agentConversation.findFirst({
    where: { userId: args.userId, surface: args.entity.kind, ...relation, archivedAt: null },
    select: { id: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (existing) {
    return existing;
  }

  const id = ulid();
  await prisma.$transaction(async (transaction) => {
    await transaction.agentConversation.create({
      data: {
        id,
        userId: args.userId,
        surface: args.entity.kind,
        title: args.message.slice(0, 60),
        ...relation,
      },
    });
    if (args.history.length > 0) {
      await transaction.agentMessage.createMany({
        data: args.history.map((historyMessage, sequence) => ({
          id: ulid(),
          conversationId: id,
          role: historyMessage.role,
          parts: historyMessage.parts as unknown as Prisma.InputJsonValue,
          sequence,
        })),
      });
    }
  });
  return { id };
}
