import { ulid } from 'ulid';
import type { Locale, MessagePart, ResearchClarificationSelectionV1 } from '@jixie/shared';
import { prisma } from '../infra/database/prisma.js';
import { researchProfile } from '../agent/profiles/research.js';
import { enqueueAgentTurn, entityKey } from '../agent/turns/run.js';
import * as turnBus from '../agent/turns/bus.js';
import { createProposeResearchCellChangesTool } from '../agent/tools/propose-research-cell-changes.js';
import { createRequestResearchClarificationTool } from '../agent/tools/request-research-clarification.js';
import {
  createResearchCatalogTurnEvidence,
  createSearchResearchCatalogTool,
} from '../agent/tools/search-research-catalog.js';
import { researchAgentDocumentContext } from './agent-context.js';
import { resolveResearchClarificationAnswer } from './proposals/clarification-records.js';
import { researchClarificationAnswerMessage } from './proposals/clarification-message.js';
import { researchAgentCellChangeAttemptContext } from './proposals/attempt-context.js';

export interface ResearchAgentTurnInput {
  conversationId?: string;
  message?: string;
  contextCellIds: string[];
  attemptId?: string;
  clarificationAnswer?: {
    clarificationId: string;
    selections: ResearchClarificationSelectionV1[];
  };
}

export class ResearchAgentTurnError extends Error {
  constructor(
    readonly reason:
      | 'conversation_not_found'
      | 'conversation_running'
      | 'clarification_pending'
      | 'attempt_not_found',
  ) {
    super(`Research Agent turn unavailable: ${reason}`);
    this.name = 'ResearchAgentTurnError';
  }
}

export async function startResearchAgentTurn(
  userId: string,
  input: ResearchAgentTurnInput,
  locale: Locale,
) {
  const { attemptId, clarificationAnswer } = input;
  let conversationId = input.conversationId;
  if (conversationId) {
    const existing = await prisma.agentConversation.findFirst({
      where: { id: conversationId, userId, surface: 'research', archivedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new ResearchAgentTurnError('conversation_not_found');
    }
  } else {
    conversationId = ulid();
    await prisma.agentConversation.create({
      data: {
        id: conversationId,
        userId,
        surface: 'research',
        title: input.message!.slice(0, 60),
      },
    });
  }

  const entity = { kind: 'research' as const, id: conversationId };
  if (turnBus.findRunning(entityKey(entity), userId)) {
    throw new ResearchAgentTurnError('conversation_running');
  }

  let message = input.message ?? '';
  if (clarificationAnswer) {
    const clarification = await resolveResearchClarificationAnswer(
      userId,
      conversationId,
      clarificationAnswer.clarificationId,
      clarificationAnswer.selections,
    );
    message = researchClarificationAnswerMessage(locale, clarification);
  }

  const document = await prisma.researchDocument.findUnique({
    where: { conversationId },
    select: {
      id: true,
      updatedAt: true,
      contentRevision: true,
      cells: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          position: true,
          kind: true,
          source: true,
          status: true,
          revision: true,
          definitions: true,
          references: true,
          output: true,
          lastExecutedRevision: true,
          lastExecutedAt: true,
        },
      },
      clarifications: {
        where: { status: 'pending' },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!clarificationAnswer && document?.clarifications.length) {
    throw new ResearchAgentTurnError('clarification_pending');
  }

  const attempt = attemptId
    ? await prisma.researchCellChangeAttempt.findFirst({
        where: {
          id: attemptId,
          document: { conversationId, userId },
          status: { in: ['success', 'error', 'cancelled'] },
        },
        include: {
          executions: {
            orderBy: { startedAt: 'asc' },
            include: { cell: { select: { kind: true, position: true } } },
          },
        },
      })
    : null;
  if (attemptId && !attempt) {
    throw new ResearchAgentTurnError('attempt_not_found');
  }

  const turnId = ulid();
  const contextCellIds = [...new Set(input.contextCellIds)];
  const agentDocument = document
    ? researchAgentDocumentContext(document, contextCellIds)
    : undefined;
  const attachedCellIdSet = new Set(agentDocument?.attachedCellIds ?? []);
  const userParts: MessagePart[] = [
    ...(attachedCellIdSet.size > 0
      ? [
          {
            type: 'research_cell_context' as const,
            snapshotVersion: 1 as const,
            cells: agentDocument!.snapshotCells,
          },
        ]
      : []),
    { type: 'text', text: message },
  ];

  const catalogEvidence = createResearchCatalogTurnEvidence();
  const catalogTool = createSearchResearchCatalogTool(catalogEvidence);
  if (attempt) {
    await prisma.researchCellChangeAttempt.update({
      where: { id: attempt.id },
      data: { explanationTurnId: turnId },
    });
  }

  enqueueAgentTurn({
    turnId,
    userId,
    profile: researchProfile(
      agentDocument?.context,
      document
        ? createProposeResearchCellChangesTool({
            userId,
            documentId: document.id,
            editableCellIds: agentDocument!.editableCellIds,
            catalogEvidence,
          })
        : undefined,
      attempt ? researchAgentCellChangeAttemptContext(attempt) : undefined,
      document
        ? createRequestResearchClarificationTool({ documentId: document.id, catalogEvidence })
        : undefined,
      catalogTool,
    ),
    entity,
    message,
    userParts,
    currentCode: '',
    locale,
  });
  return { conversationId, turnId };
}
