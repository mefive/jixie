import type { Prisma } from '@prisma/client';
import { normalizeChatMessage } from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '../src/lib/prisma.js';

async function main(): Promise<void> {
  let created = 0;
  const strategies = await prisma.strategy.findMany({
    select: { id: true, userId: true, name: true, messages: true },
  });
  for (const strategy of strategies) {
    if (!Array.isArray(strategy.messages)) {
      continue;
    }
    created += await migrateHost({
      userId: strategy.userId,
      surface: 'strategy',
      title: strategy.name,
      messages: strategy.messages,
      relation: { strategyId: strategy.id },
    });
  }

  const factors = await prisma.factor.findMany({
    where: { userId: { not: 'builtin' } },
    select: { id: true, userId: true, name: true, messages: true },
  });
  for (const factor of factors) {
    if (!Array.isArray(factor.messages)) {
      continue;
    }
    created += await migrateHost({
      userId: factor.userId,
      surface: 'factor',
      title: factor.name,
      messages: factor.messages,
      relation: { factorId: factor.id },
    });
  }

  const screens = await prisma.screenConversation.findMany({
    select: { id: true, userId: true, title: true, messages: true },
  });
  for (const screen of screens) {
    created += await migrateHost({
      userId: screen.userId,
      surface: 'screen',
      title: screen.title,
      messages: screen.messages,
      relation: { screenConversationId: screen.id },
    });
  }

  console.log(`Created ${created} Agent conversation(s)`);
}

async function migrateHost(args: {
  userId: string;
  surface: 'strategy' | 'factor' | 'screen';
  title: string;
  messages: Prisma.JsonValue | null;
  relation: { strategyId?: string; factorId?: string; screenConversationId?: string };
}): Promise<number> {
  const existing = await prisma.agentConversation.findFirst({
    where: { userId: args.userId, surface: args.surface, ...args.relation },
    select: { id: true },
  });
  if (existing) {
    return 0;
  }
  const messages = Array.isArray(args.messages)
    ? args.messages.map((message) => normalizeChatMessage(message))
    : [];
  const conversationId = ulid();
  await prisma.$transaction(async (transaction) => {
    await transaction.agentConversation.create({
      data: {
        id: conversationId,
        userId: args.userId,
        surface: args.surface,
        title: args.title,
        ...args.relation,
      },
    });
    if (messages.length > 0) {
      await transaction.agentMessage.createMany({
        data: messages.map((message, sequence) => ({
          id: ulid(),
          conversationId,
          role: message.role,
          parts: message.parts as unknown as Prisma.InputJsonValue,
          sequence,
        })),
      });
    }
  });
  return 1;
}

await main().finally(() => prisma.$disconnect());
