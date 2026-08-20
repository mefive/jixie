import type { Prisma } from '@prisma/client';
import {
  type AgentTraceStep,
  type AgentTurnTrace,
  type ChatMessage,
  type MessagePart,
} from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '../lib/prisma.js';
import { persistResearchCellChangePart } from '../research/research-cell-change-records.js';
import type { TurnEntity } from './turn-run.js';

const EMPTY_TRACE: AgentTurnTrace = { version: 1, steps: [], truncated: false };

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
}): Promise<PersistentTurn> {
  const conversation = await findOrCreateConversation(args);

  const inputMessageId = ulid();
  await prisma.$transaction(async (transaction) => {
    const last = await transaction.agentMessage.findFirst({
      where: { conversationId: conversation.id },
      select: { sequence: true },
      orderBy: { sequence: 'desc' },
    });
    await transaction.agentTurn.create({
      data: {
        id: args.turnId,
        conversationId: conversation.id,
        status: 'running',
        model: args.model,
        trace: EMPTY_TRACE as unknown as Prisma.InputJsonValue,
      },
    });
    await transaction.agentMessage.create({
      data: {
        id: inputMessageId,
        conversationId: conversation.id,
        role: 'user',
        parts: [{ type: 'text', text: args.message }] as Prisma.InputJsonValue,
        sequence: (last?.sequence ?? -1) + 1,
        turnId: args.turnId,
      },
    });
  });

  return { conversationId: conversation.id, inputMessageId };
}

async function findOrCreateConversation(args: {
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

export async function finishPersistentTurn(args: {
  turnId: string;
  status: 'done' | 'error' | 'cancelled';
  parts?: MessagePart[];
  error?: string;
  trace: AgentTurnTrace;
}): Promise<MessagePart[] | undefined> {
  return prisma.$transaction(async (transaction) => {
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
      const last = await transaction.agentMessage.findFirst({
        where: { conversationId: turn.conversationId },
        select: { sequence: true },
        orderBy: { sequence: 'desc' },
      });
      const messageId = ulid();
      await transaction.agentMessage.create({
        data: {
          id: messageId,
          conversationId: turn.conversationId,
          role: 'assistant',
          parts: args.parts as unknown as Prisma.InputJsonValue,
          sequence: (last?.sequence ?? -1) + 1,
          turnId: args.turnId,
        },
      });
      persistedParts = [...args.parts];
      const researchCellChangePartIndexes = persistedParts.flatMap((part, partIndex) =>
        part.type === 'research_cell_change' ? [partIndex] : [],
      );
      if (researchCellChangePartIndexes.length > 0) {
        if (turn.conversation.surface !== 'research') {
          throw new Error('Research Cell change proposals require a Research conversation.');
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

export class AgentTraceRecorder {
  public readonly trace: AgentTurnTrace = { version: 1, steps: [], truncated: false };
  private checkpoint = Promise.resolve();
  private modelStartedAt = new Map<number, number>();
  private reasoning = new Map<number, string>();

  public constructor(
    private readonly turnId: string,
    private readonly model: string,
  ) {}

  public modelStart(modelCall: number, toolsEnabled: string[]): void {
    this.modelStartedAt.set(modelCall, Date.now());
    this.push({
      type: 'model',
      modelCall,
      model: this.model,
      toolsEnabled,
      status: 'running',
    });
  }

  public reasoningDelta(modelCall: number, text: string): void {
    this.reasoning.set(modelCall, (this.reasoning.get(modelCall) ?? '') + text);
  }

  public modelDone(modelCall: number): void {
    const step = [...this.trace.steps]
      .reverse()
      .find((candidate) => candidate.type === 'model' && candidate.modelCall === modelCall);
    if (step?.type === 'model') {
      step.reasoning = this.reasoning.get(modelCall);
      step.status = 'success';
      step.durationMs = Date.now() - (this.modelStartedAt.get(modelCall) ?? Date.now());
      this.queueCheckpoint();
    }
  }

  public tool(args: {
    modelCall: number;
    toolCallId: string;
    name: string;
    arguments: string;
    observation: string;
    ok: boolean;
    rows?: number;
    durationMs: number;
  }): void {
    this.push({ type: 'tool', ...args });
  }

  public validation(round: number, ok: boolean, durationMs: number, error?: string): void {
    this.push({ type: 'validation', round, ok, durationMs, error });
  }

  public terminal(type: 'error' | 'cancelled', message?: string): void {
    this.push({ type, message });
  }

  public async flush(): Promise<void> {
    await this.checkpoint;
  }

  private push(step: TraceStepInput): void {
    this.trace.steps.push({
      ...step,
      id: ulid(),
      sequence: this.trace.steps.length,
      createdAt: new Date().toISOString(),
    } as AgentTraceStep);
    this.queueCheckpoint();
  }

  private queueCheckpoint(): void {
    this.checkpoint = this.checkpoint
      .then(() =>
        prisma.agentTurn.updateMany({
          where: { id: this.turnId, status: 'running' },
          data: { trace: this.trace as unknown as Prisma.InputJsonValue },
        }),
      )
      .then(() => undefined);
  }
}

type TraceStepInput = AgentTraceStep extends infer Step
  ? Step extends AgentTraceStep
    ? Omit<Step, 'id' | 'sequence' | 'createdAt'>
    : never
  : never;

export async function markRunningAgentTurnsInterrupted(): Promise<number> {
  const result = await prisma.agentTurn.updateMany({
    where: { status: 'running' },
    data: { status: 'interrupted', finishedAt: new Date(), error: 'API process restarted' },
  });
  return result.count;
}
