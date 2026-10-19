import type { Prisma } from '@prisma/client';
import type { ChatMessage, Locale } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { t } from '#i18n/index.js';
import type { TurnEntity } from '../turns/run.js';
import { readCodeProposalHistory } from './code-proposals.js';

// —— entity messages IO ——

/**
 * 读取并校验实体持久化对话消息，为恢复 Agent 上下文提供可信历史。
 *
 * Read and validate an entity's persisted messages before restoring agent context.
 */
export async function readMessages(
  entity: TurnEntity,
  userId: string,
  locale: Locale,
): Promise<unknown[]> {
  if (entity.kind === 'research' || entity.kind === 'factor-question') {
    const conversation = await prisma.agentConversation.findFirst({
      where: {
        id: entity.id,
        userId,
        surface: entity.kind,
        archivedAt: null,
        NOT: { researchDocument: { embeddedVersion: { isNot: null } } },
      },
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
  return Array.isArray(row.messages)
    ? readCodeProposalHistory(prisma, userId, entity.kind, entity.id, row.messages)
    : [];
}

/**
 * 将实体对话消息写回其持久化会话，供后续轮次恢复。
 *
 * Persist entity conversation messages for subsequent turns.
 */
export async function writeMessages(entity: TurnEntity, messages: ChatMessage[]): Promise<void> {
  if (entity.kind === 'research' || entity.kind === 'factor-question') {
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
