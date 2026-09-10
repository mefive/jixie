import type { Prisma } from '@prisma/client';
import type {
  ResearchDocumentV1,
  ChatMessage,
  ResearchCellV1,
  ResearchCellKindV1,
  ResearchCellOutputBlockV1,
} from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { legacyDefinition } from '../templates/document-templates.js';
import { cellCreate } from './cell-seed.js';
import { listResearchCellChangeAttempts } from '../proposals/attempt-records.js';
import { researchCellChangeReviewView } from '../proposals/change-records.js';
import { jsonStringArray, researchCellDependencyIssues } from '../dependencies/cell-values.js';

type ResearchDocumentRow = Prisma.ResearchDocumentGetPayload<{
  include: {
    conversation: {
      include: { messages: true };
    };
    cells: true;
    cellChangeProposals: true;
  };
}>;

/** Load an owned document, materializing its legacy conversation on the first read. */
export async function getResearchDocument(
  userId: string,
  documentId: string,
): Promise<ResearchDocumentV1 | null> {
  const owner = await prisma.agentConversation.findFirst({
    where: { id: documentId, userId, surface: 'research', archivedAt: null },
    select: { id: true, title: true, researchDocument: { select: { id: true } } },
  });
  if (!owner) {
    return null;
  }
  if (!owner.researchDocument) {
    const definition = legacyDefinition(owner.title ?? '');
    await prisma.researchDocument.create({
      data: {
        id: owner.id,
        userId,
        conversationId: owner.id,
        cells: { create: definition.cells.map((cell, position) => cellCreate(cell, position)) },
      },
    });
  }
  const document = await loadDocumentRow(userId, documentId);
  if (!document) {
    return null;
  }
  return {
    ...documentView(document),
    cellChangeAttempts: await listResearchCellChangeAttempts(userId, documentId),
  };
}

async function loadDocumentRow(
  userId: string,
  documentId: string,
): Promise<ResearchDocumentRow | null> {
  return prisma.researchDocument.findFirst({
    where: { id: documentId, userId },
    include: {
      conversation: {
        include: { messages: { orderBy: { sequence: 'asc' }, take: 100 } },
      },
      cells: { orderBy: { position: 'asc' } },
      cellChangeProposals: {
        where: { reviewStatus: 'open' },
        orderBy: { reviewSequence: 'asc' },
      },
    },
  });
}

function documentView(document: ResearchDocumentRow): ResearchDocumentV1 {
  const activeCellChangeReview = researchCellChangeReviewView(document.cellChangeProposals);
  return {
    version: 1,
    id: document.id,
    conversationId: document.conversationId,
    title: document.conversation.title ?? '',
    runtimeVersion: 'research-py-v1',
    contentRevision: document.contentRevision,
    cells: document.cells.map(cellView),
    ...(activeCellChangeReview ? { activeCellChangeReview } : {}),
    cellChangeAttempts: [],
    messages: document.conversation.messages.map(
      (message): ChatMessage => ({
        id: message.id,
        role: message.role === 'assistant' ? 'assistant' : 'user',
        parts: message.parts as unknown as ChatMessage['parts'],
        turnId: message.turnId ?? undefined,
        sequence: message.sequence,
        createdAt: message.createdAt.toISOString(),
      }),
    ),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function cellView(cell: ResearchDocumentRow['cells'][number]): ResearchCellV1 {
  return {
    version: 1,
    id: cell.id,
    documentId: cell.documentId,
    position: cell.position,
    kind: cell.kind as ResearchCellKindV1,
    source: cell.source,
    ...(cell.config ? { config: cell.config as Record<string, unknown> } : {}),
    status: cell.status as ResearchCellV1['status'],
    revision: cell.revision,
    definitions: jsonStringArray(cell.definitions),
    references: jsonStringArray(cell.references),
    dependencyIssues: researchCellDependencyIssues(cell.dependencyIssues),
    outputs: Array.isArray(cell.output)
      ? (cell.output as unknown as ResearchCellOutputBlockV1[])
      : [],
    ...(cell.lastExecutedRevision != null
      ? { lastExecutedRevision: cell.lastExecutedRevision }
      : {}),
    ...(cell.lastExecutedAt ? { lastExecutedAt: cell.lastExecutedAt.toISOString() } : {}),
    createdAt: cell.createdAt.toISOString(),
    updatedAt: cell.updatedAt.toISOString(),
  };
}
