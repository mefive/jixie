import {
  acquireWorkOwner,
  MarketAccessBusyError,
  type MarketLock,
} from '#infra/coordination/market-access.js';
import type { Prisma } from '@prisma/client';
import {
  type AgentTurnTrace,
  type ChatMessage,
  type MessagePart,
  type FactorQuestionContextV1,
  type EmbeddedAnalysisPart,
  normalizeChatMessage,
} from '@jixie/shared';
import { ulid } from 'ulid';
import { codeProposalView, type CodeProposalContext } from '../conversations/code-proposals.js';
import { getDatabase } from '#infra/database/prisma.js';
import { persistResearchCellChangePart } from '#research/proposals/change-records.js';
import { persistResearchClarificationPart } from '#research/proposals/clarification-records.js';
import type { TurnEntity } from './run.js';
import { findOrCreateConversation } from '../conversations/manage.js';

const EMPTY_TRACE: AgentTurnTrace = { version: 1, steps: [], truncated: false };

/**
 * 保存 Agent 轮次输入、归属和执行状态，支持中断后查询与追溯。
 *
 * Persist an agent turn's input, ownership and execution state for recovery and inspection.
 */
export interface PersistentTurn {
  conversationId: string;
  inputMessageId: string;
}

export async function startPersistentTurn(args: {
  turnId: string;
  userId: string;
  entity: TurnEntity;
  history: ChatMessage[];
  message: string;
  model: string;
  userParts?: MessagePart[];
}): Promise<PersistentTurn> {
  const conversation = await findOrCreateConversation(args);

  return getDatabase().$transaction((transaction) =>
    createPersistentTurnInput(transaction, {
      turnId: args.turnId,
      conversationId: conversation.id,
      model: args.model,
      userParts: args.userParts ?? [{ type: 'text', text: args.message }],
    }),
  );
}

/**
 * 允许业务在同一事务中预留会话并持久化本轮输入。
 *
 * Allows a domain to reserve its conversation and persist the input in one transaction.
 */
export async function createPersistentTurnInput(
  transaction: Prisma.TransactionClient,
  args: {
    turnId: string;
    conversationId: string;
    model: string;
    userParts: MessagePart[];
    contextSnapshot?: FactorQuestionContextV1;
  },
): Promise<PersistentTurn> {
  const last = await transaction.agentMessage.findFirst({
    where: { conversationId: args.conversationId },
    select: { sequence: true },
    orderBy: { sequence: 'desc' },
  });
  await transaction.agentTurn.create({
    data: {
      id: args.turnId,
      conversationId: args.conversationId,
      status: 'running',
      model: args.model,
      trace: EMPTY_TRACE as unknown as Prisma.InputJsonValue,
      ...(args.contextSnapshot
        ? { contextSnapshot: args.contextSnapshot as unknown as Prisma.InputJsonValue }
        : {}),
    },
  });
  const inputMessageId = ulid();
  await transaction.agentMessage.create({
    data: {
      id: inputMessageId,
      conversationId: args.conversationId,
      role: 'user',
      parts: args.userParts as unknown as Prisma.InputJsonValue,
      sequence: (last?.sequence ?? -1) + 1,
      turnId: args.turnId,
    },
  });
  return { conversationId: args.conversationId, inputMessageId };
}

/**
 * 持久化轮次终态和输出，供历史查询与故障追溯。
 *
 * Persist the terminal turn state and output for history and diagnostics.
 */
export async function finishPersistentTurn(args: {
  turnId: string;
  status: 'done' | 'error' | 'cancelled';
  parts?: MessagePart[];
  error?: string;
  trace: AgentTurnTrace;
  codeChange?: CodeProposalContext & { afterCode: string };
}): Promise<MessagePart[] | undefined> {
  return getDatabase().$transaction(async (transaction) => {
    const turn = await transaction.agentTurn.findUnique({
      where: { id: args.turnId },
      select: {
        conversationId: true,
        conversation: { select: { surface: true, userId: true } },
      },
    });
    if (!turn) {
      return undefined;
    }
    let persistedParts: MessagePart[] | undefined;
    if (args.status === 'done' && args.parts) {
      const existing = await transaction.agentMessage.findFirst({
        where: { turnId: args.turnId, role: 'assistant' },
      });
      const last = await transaction.agentMessage.findFirst({
        where: { conversationId: turn.conversationId },
        select: { sequence: true },
        orderBy: { sequence: 'desc' },
      });
      const messageId = existing?.id ?? ulid();
      persistedParts = mergeEmbeddedParts(
        args.parts,
        existing ? normalizeChatMessage(existing).parts : [],
      );
      await transaction.agentMessage.upsert({
        where: { id: messageId },
        update: { parts: persistedParts as unknown as Prisma.InputJsonValue },
        create: {
          id: messageId,
          conversationId: turn.conversationId,
          role: 'assistant',
          parts: persistedParts as unknown as Prisma.InputJsonValue,
          sequence: (last?.sequence ?? -1) + 1,
          turnId: args.turnId,
        },
      });
      if (args.codeChange) {
        const { afterCode, ...context } = args.codeChange;
        if (context.surface !== turn.conversation.surface) {
          throw new Error('Code proposal surface must match its conversation.');
        }
        const proposal = await transaction.agentCodeChangeProposal.create({
          data: {
            id: ulid(),
            userId: turn.conversation.userId,
            ...context,
            afterCode,
            sourceTurnId: args.turnId,
            sourceMessageId: messageId,
          },
        });
        persistedParts.push({ type: 'code_change', proposal: codeProposalView(proposal) });
        await transaction.agentMessage.update({
          where: { id: messageId },
          data: { parts: persistedParts as unknown as Prisma.InputJsonValue },
        });
      }
      const researchCellChangePartIndexes = persistedParts.flatMap((part, partIndex) =>
        part.type === 'research_cell_change' ? [partIndex] : [],
      );
      const researchClarificationPartIndexes = persistedParts.flatMap((part, partIndex) =>
        part.type === 'research_clarification' ? [partIndex] : [],
      );
      if (researchCellChangePartIndexes.length > 0 || researchClarificationPartIndexes.length > 0) {
        if (turn.conversation.surface !== 'research') {
          throw new Error('Research artifacts require a Research conversation.');
        }
        for (const partIndex of researchCellChangePartIndexes) {
          const part = persistedParts[partIndex];
          if (part.type !== 'research_cell_change') {
            continue;
          }
          persistedParts[partIndex] = await persistResearchCellChangePart(transaction, {
            conversationId: turn.conversationId,
            messageId,
            turnId: args.turnId,
            userId: turn.conversation.userId,
            partIndex,
            part,
          });
        }
        for (const partIndex of researchClarificationPartIndexes) {
          const part = persistedParts[partIndex];
          if (part.type !== 'research_clarification') {
            continue;
          }
          persistedParts[partIndex] = await persistResearchClarificationPart(transaction, {
            conversationId: turn.conversationId,
            messageId,
            turnId: args.turnId,
            userId: turn.conversation.userId,
            partIndex,
            part,
          });
        }
        await transaction.agentMessage.update({
          where: { id: messageId },
          data: { parts: persistedParts as unknown as Prisma.InputJsonValue },
        });
      }
    }
    await transaction.agentTurn.update({
      where: { id: args.turnId },
      data: {
        status: args.status,
        trace: args.trace as unknown as Prisma.InputJsonValue,
        error: args.error,
        finishedAt: new Date(),
      },
    });
    return persistedParts;
  });
}

/**
 * 在等待 Python 或生成模型解释前保存精确运行引用。
 *
 * Save the exact run before the tool waits for Python or the model generates its explanation.
 */
export async function persistEmbeddedAnalysisPart(turnId: string, part: EmbeddedAnalysisPart) {
  return getDatabase().$transaction(async (transaction) => {
    const turn = await transaction.agentTurn.findUnique({
      where: { id: turnId },
      include: { conversation: true },
    });
    if (!turn || turn.status !== 'running') {
      throw new Error('An active persisted conversation is required for embedded analysis');
    }
    const conversation = turn.conversation;
    const hostType = conversation.surface === 'strategy' ? 'strategy' : 'factor';
    const hostId =
      conversation.strategyId ?? conversation.factorId ?? conversation.questionFactorKey;
    const run = await transaction.researchExecution.findFirst({
      where: {
        id: part.reference.runId,
        embeddedVersionId: part.reference.versionId,
        embeddedVersion: {
          analysisId: part.reference.analysisId,
          analysis: {
            userId: conversation.userId,
            hostType,
            hostId: hostId ?? '',
          },
        },
      },
      select: { id: true },
    });
    if (!run || !hostId) {
      throw new Error('The embedded run does not belong to this conversation');
    }
    const existing = await transaction.agentMessage.findFirst({
      where: { turnId, role: 'assistant' },
    });
    const parts = mergeEmbeddedParts(existing ? normalizeChatMessage(existing).parts : [], [part]);
    const last = await transaction.agentMessage.findFirst({
      where: { conversationId: conversation.id },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });
    const messageId = existing?.id ?? ulid();
    await transaction.agentMessage.upsert({
      where: { id: messageId },
      update: { parts: parts as unknown as Prisma.InputJsonValue },
      create: {
        id: messageId,
        conversationId: conversation.id,
        role: 'assistant',
        parts: parts as unknown as Prisma.InputJsonValue,
        turnId,
        sequence: (last?.sequence ?? -1) + 1,
      },
    });
    return parts;
  });
}

function mergeEmbeddedParts(parts: MessagePart[], saved: MessagePart[]): MessagePart[] {
  const references = new Set(
    parts.flatMap((part) => (part.type === 'embedded_analysis' ? [part.reference.runId] : [])),
  );
  return [
    ...parts,
    ...saved.filter(
      (part) => part.type === 'embedded_analysis' && !references.has(part.reference.runId),
    ),
  ];
}

export async function markRunningAgentTurnsInterrupted(): Promise<number> {
  const turns = await getDatabase().agentTurn.findMany({
    where: { status: 'running' },
    select: { id: true },
  });
  let count = 0;
  for (const turn of turns) {
    let owner: MarketLock;
    try {
      owner = await acquireWorkOwner('agent', turn.id);
    } catch (error) {
      if (error instanceof MarketAccessBusyError) {
        continue;
      }
      throw error;
    }
    try {
      const result = await getDatabase().agentTurn.updateMany({
        where: { id: turn.id, status: 'running' },
        data: {
          status: 'interrupted',
          finishedAt: new Date(),
          error: 'Owning Agent process exited',
        },
      });
      count += result.count;
    } finally {
      await owner.release();
    }
  }
  return count;
}
