import type { Prisma } from '@prisma/client';
import type { ChatMessage, Locale } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { t } from '#i18n/index.js';
import type { TurnEntity } from '../turns/run.js';

// —— entity messages IO ——

export async function readMessages(
  entity: TurnEntity,
  userId: string,
  locale: Locale,
): Promise<unknown[]> {
  if (entity.kind === 'research') {
    const conversation = await prisma.agentConversation.findFirst({
      where: { id: entity.id, userId, surface: 'research', archivedAt: null },
      select: {
        messages: {
          orderBy: { sequence: 'asc' },
          select: {
            id: true,
            role: true,
            parts: true,
            turnId: true,
            sequence: true,
            createdAt: true,
          },
        },
      },
    });
    if (!conversation) {
      throw new Error(t(locale, 'turnHostGone'));
    }
    return conversation.messages.map((message) => ({
      id: message.id,
      role: message.role,
      parts: message.parts,
      turnId: message.turnId ?? undefined,
      sequence: message.sequence,
      createdAt: message.createdAt.toISOString(),
    }));
  }
  const where = { id: entity.id, userId };

  // Exhaustive switch: a new entity kind leaves `row` unassigned and fails the build.
  let row: { messages: Prisma.JsonValue } | null;
  switch (entity.kind) {
    case 'strategy':
      row = await prisma.strategy.findFirst({ where, select: { messages: true } });
      break;
    case 'factor':
      row = await prisma.factor.findFirst({ where, select: { messages: true } });
      break;
  }

  if (!row) {
    throw new Error(t(locale, 'turnHostGone'));
  }
  return Array.isArray(row.messages) ? (row.messages as unknown[]) : [];
}

export async function writeMessages(entity: TurnEntity, messages: ChatMessage[]): Promise<void> {
  if (entity.kind === 'research') {
    return;
  }
  const data = { messages: messages as unknown as Prisma.InputJsonValue };

  switch (entity.kind) {
    case 'strategy':
      await prisma.strategy.update({ where: { id: entity.id }, data });
      break;
    case 'factor':
      if (
        (
          await prisma.factor.updateMany({
            where: { id: entity.id, status: 'draft' },
            data,
          })
        ).count !== 1
      ) {
        throw new Error('Published factor conversation is immutable');
      }
      break;
    default:
      entity.kind satisfies never; // compile error when a new kind is added but unhandled
  }
}
