import { ulid } from 'ulid';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type {
  ChatMessage,
  FactorQuestionContextV1,
  FactorQuestionHistoryV1,
  FactorQuestionTurnV1,
  Locale,
} from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { t } from '#i18n/index.js';
import { createPersistentTurnInput } from '#agent/turns/records.js';
import { enqueueAgentTurn } from '#agent/turns/run.js';
import { factorQaProfile } from '#agent/profiles/qa.js';
import { failFactorOperation } from '../operation-errors.js';
import { captureFactorQuestionContext } from './context.js';

export const factorQuestionSchema = z.strictObject({
  factorKey: z.string().min(1).max(128),
  message: z.string().trim().min(1).max(2000),
  reportId: z.string().min(1).max(128).optional(),
});
export const factorQuestionHistorySchema = z.object({
  before: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

const messageSelection = {
  id: true,
  role: true,
  parts: true,
  sequence: true,
  turnId: true,
  createdAt: true,
  turn: { select: { contextSnapshot: true, status: true, error: true } },
} satisfies Prisma.AgentMessageSelect;
type MessageRow = Prisma.AgentMessageGetPayload<{ select: typeof messageSelection }>;

function questionMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    parts: row.parts as unknown as ChatMessage['parts'],
    sequence: row.sequence,
    turnId: row.turnId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    ...(row.role === 'user' && row.turn
      ? {
          contextSnapshot: row.turn.contextSnapshot as unknown as FactorQuestionContextV1,
          turnStatus: row.turn.status as ChatMessage['turnStatus'],
          turnError: row.turn.error ?? undefined,
        }
      : {}),
  };
}

export async function readFactorQuestions(
  userId: string,
  factorKey: string,
  query: z.infer<typeof factorQuestionHistorySchema>,
  locale: Locale,
): Promise<FactorQuestionHistoryV1> {
  return prisma.$transaction(async (database) => {
    const conversation = await database.agentConversation.findUnique({
      where: { userId_questionFactorKey: { userId, questionFactorKey: factorKey } },
      select: { id: true, turns: { where: { status: 'running' }, select: { id: true }, take: 1 } },
    });
    if (!conversation) {
      await captureFactorQuestionContext(database, userId, factorKey, undefined, locale);
      return { conversationId: null, messages: [], nextBefore: null, activeTurnId: null };
    }
    const rows = await database.agentMessage.findMany({
      where: {
        conversationId: conversation.id,
        ...(query.before === undefined ? {} : { sequence: { lt: query.before } }),
      },
      select: messageSelection,
      orderBy: { sequence: 'desc' },
      take: query.limit + 1,
    });
    const messages = rows.slice(0, query.limit).reverse().map(questionMessage);
    return {
      conversationId: conversation.id,
      messages,
      nextBefore: rows.length > query.limit ? messages[0].sequence! : null,
      activeTurnId: conversation.turns[0]?.id ?? null,
    };
  });
}

export async function startFactorQuestion(
  userId: string,
  raw: z.infer<typeof factorQuestionSchema>,
  locale: Locale,
): Promise<FactorQuestionTurnV1> {
  const input = factorQuestionSchema.parse(raw);
  const turnId = ulid();
  const model = process.env.DEEPSEEK_AGENT_MODEL ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
  const prepared = await prisma.$transaction(async (database) => {
    const context = await captureFactorQuestionContext(
      database,
      userId,
      input.factorKey,
      input.reportId,
      locale,
    );
    const conversation = await database.agentConversation.upsert({
      where: { userId_questionFactorKey: { userId, questionFactorKey: input.factorKey } },
      create: {
        id: ulid(),
        userId,
        surface: 'factor-question',
        questionFactorKey: input.factorKey,
        title: context.factor.name,
      },
      update: { updatedAt: new Date() },
      select: { id: true },
    });
    if (
      await database.agentTurn.findFirst({
        where: { conversationId: conversation.id, status: 'running' },
        select: { id: true },
      })
    ) {
      return failFactorOperation('conflict', t(locale, 'factorTurnInProgress'));
    }
    const history = (
      await database.agentMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { sequence: 'desc' },
        take: 60,
        select: messageSelection,
      })
    )
      .reverse()
      .map(questionMessage);
    const { inputMessageId } = await createPersistentTurnInput(database, {
      turnId,
      conversationId: conversation.id,
      model,
      userParts: [{ type: 'text', text: input.message }],
      contextSnapshot: context,
    });
    const message = questionMessage(
      await database.agentMessage.findUniqueOrThrow({
        where: { id: inputMessageId },
        select: messageSelection,
      }),
    );
    return { conversationId: conversation.id, context, history, message };
  });
  enqueueAgentTurn({
    turnId,
    userId,
    entity: { kind: 'factor-question', id: prepared.conversationId },
    profile: factorQaProfile(prepared.context),
    message: input.message,
    currentCode: '',
    locale,
    persistedInput: { history: prepared.history, message: prepared.message },
  });
  return { turnId, conversationId: prepared.conversationId, message: prepared.message };
}
