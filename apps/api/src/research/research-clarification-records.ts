import { Prisma, type ResearchClarification as ResearchClarificationRow } from '@prisma/client';
import type {
  MessagePart,
  ResearchClarificationAnswerV1,
  ResearchClarificationPart,
  ResearchClarificationQuestionV1,
  ResearchClarificationSelectionV1,
  ResearchClarificationStatusV1,
  ResearchClarificationV1,
} from '@jixie/shared';
import { prisma } from '../lib/prisma.js';

interface PersistResearchClarificationPartArgs {
  conversationId: string;
  messageId: string;
  turnId?: string;
  userId: string;
  partIndex: number;
  part: ResearchClarificationPart;
}

export class ResearchClarificationAnswerError extends Error {
  public constructor(readonly reason: 'not_found' | 'already_resolved' | 'invalid_answer') {
    super(reason);
    this.name = 'ResearchClarificationAnswerError';
  }
}

/** Materialize a server-authored clarification only after its assistant message is committed. */
export async function persistResearchClarificationPart(
  transaction: Prisma.TransactionClient,
  args: PersistResearchClarificationPartArgs,
): Promise<ResearchClarificationPart> {
  if (!args.turnId) {
    throw new Error('Research clarifications require a source Agent turn.');
  }
  const existing = await transaction.researchClarification.findUnique({
    where: {
      sourceMessageId_sourcePartIndex: {
        sourceMessageId: args.messageId,
        sourcePartIndex: args.partIndex,
      },
    },
  });
  if (existing) {
    return { type: 'research_clarification', clarification: researchClarificationView(existing) };
  }

  const document = await transaction.researchDocument.findFirst({
    where: {
      id: args.part.clarification.documentId,
      conversationId: args.conversationId,
      userId: args.userId,
    },
    select: { id: true },
  });
  if (!document) {
    throw new Error('Research document for clarification was not found.');
  }

  const clarification = args.part.clarification;
  const created = await transaction.researchClarification.create({
    data: {
      id: clarification.id,
      documentId: document.id,
      sourceTurnId: args.turnId,
      sourceMessageId: args.messageId,
      sourcePartIndex: args.partIndex,
      title: clarification.title,
      questions: clarification.questions as unknown as Prisma.InputJsonValue,
      status: 'pending',
      createdAt: new Date(clarification.createdAt),
    },
  });
  return { type: 'research_clarification', clarification: researchClarificationView(created) };
}

export async function resolveResearchClarificationAnswer(
  userId: string,
  conversationId: string,
  clarificationId: string,
  selections: ResearchClarificationSelectionV1[],
): Promise<ResearchClarificationV1> {
  return prisma.$transaction(async (transaction) => {
    const clarification = await transaction.researchClarification.findFirst({
      where: { id: clarificationId, document: { userId, conversationId } },
    });
    if (!clarification) {
      throw new ResearchClarificationAnswerError('not_found');
    }
    if (clarification.status !== 'pending') {
      throw new ResearchClarificationAnswerError('already_resolved');
    }

    const questions = clarification.questions as unknown as ResearchClarificationQuestionV1[];
    validateSelections(questions, selections);
    const answeredAt = new Date();
    const answer: ResearchClarificationAnswerV1 = {
      selections: selections.map((selection) => ({
        questionId: selection.questionId,
        selectedOptionIds: [...selection.selectedOptionIds],
        ...(selection.customText?.trim() ? { customText: selection.customText.trim() } : {}),
      })),
      answeredAt: answeredAt.toISOString(),
    };
    await transaction.researchClarification.update({
      where: { id: clarification.id },
      data: {
        status: 'answered',
        answer: answer as unknown as Prisma.InputJsonValue,
        answeredAt,
      },
    });
    return syncResearchClarificationRecord(transaction, clarification.id);
  });
}

async function syncResearchClarificationRecord(
  transaction: Prisma.TransactionClient,
  clarificationId: string,
): Promise<ResearchClarificationV1> {
  const clarification = await transaction.researchClarification.findUniqueOrThrow({
    where: { id: clarificationId },
  });
  const sourceMessage = await transaction.agentMessage.findUnique({
    where: { id: clarification.sourceMessageId },
    select: { parts: true },
  });
  if (!sourceMessage || !Array.isArray(sourceMessage.parts)) {
    throw new Error('Research clarification source message was not found.');
  }

  const view = researchClarificationView(clarification);
  const parts = [...(sourceMessage.parts as unknown as MessagePart[])];
  const sourcePart = parts[clarification.sourcePartIndex];
  if (
    sourcePart?.type !== 'research_clarification' ||
    sourcePart.clarification.id !== clarification.id
  ) {
    throw new Error('Research clarification source part does not match its record.');
  }
  parts[clarification.sourcePartIndex] = { type: 'research_clarification', clarification: view };
  await transaction.agentMessage.update({
    where: { id: clarification.sourceMessageId },
    data: { parts: parts as unknown as Prisma.InputJsonValue },
  });
  return view;
}

export function researchClarificationView(
  clarification: ResearchClarificationRow,
): ResearchClarificationV1 {
  return {
    version: 1,
    id: clarification.id,
    documentId: clarification.documentId,
    title: clarification.title,
    status: clarification.status as ResearchClarificationStatusV1,
    questions: clarification.questions as unknown as ResearchClarificationQuestionV1[],
    ...(clarification.answer
      ? { answer: clarification.answer as unknown as ResearchClarificationAnswerV1 }
      : {}),
    createdAt: clarification.createdAt.toISOString(),
  };
}

function validateSelections(
  questions: ResearchClarificationQuestionV1[],
  selections: ResearchClarificationSelectionV1[],
): void {
  if (
    selections.length !== questions.length ||
    new Set(selections.map((selection) => selection.questionId)).size !== selections.length
  ) {
    throw new ResearchClarificationAnswerError('invalid_answer');
  }

  for (const question of questions) {
    const selection = selections.find((candidate) => candidate.questionId === question.id);
    if (!selection) {
      throw new ResearchClarificationAnswerError('invalid_answer');
    }
    const selectedOptionIds = [...new Set(selection.selectedOptionIds)];
    if (
      selectedOptionIds.length !== selection.selectedOptionIds.length ||
      selectedOptionIds.some(
        (optionId) => !question.options.some((option) => option.id === optionId),
      ) ||
      (question.selectionMode === 'single' && selectedOptionIds.length > 1) ||
      selectedOptionIds.length > question.options.length
    ) {
      throw new ResearchClarificationAnswerError('invalid_answer');
    }
    const customText = selection.customText?.trim() ?? '';
    if ((!question.allowCustom && customText) || (selectedOptionIds.length === 0 && !customText)) {
      throw new ResearchClarificationAnswerError('invalid_answer');
    }
  }
}
