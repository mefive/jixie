import { normalizeChatMessage } from '@jixie/shared';
import { getDatabase } from '#infra/database/prisma.js';
import type {
  ChatMessage,
  ResearchCellKindV1,
  ResearchCellOutputBlockV1,
  ResearchCellV1,
  ResearchDocumentListStateV1,
  ResearchDocumentSummaryV1,
  ResearchDocumentV1,
} from '@jixie/shared';
import type { Prisma } from '@prisma/client';
import { jsonStringArray, researchCellDependencyIssues } from '../dependencies/cell-values.js';
import { ResearchError } from '../errors.js';
import { listResearchCellChangeAttempts } from '../proposals/attempt-records.js';
import { researchCellChangeReviewView } from '../proposals/change-records.js';
import { legacyDefinition } from './initial-content.js';
import { cellCreate } from './cell-seed.js';

type ResearchDocumentRow = Prisma.ResearchDocumentGetPayload<{
  include: {
    conversation: {
      include: { messages: true };
    };
    cells: true;
    cellChangeProposals: true;
  };
}>;

/**
 * 按用户归属列出研究文档及最近状态，供工作台导航。
 *
 * List owned research documents and recent state for workspace navigation.
 */
export async function listResearchDocuments(
  userId: string,
  state: ResearchDocumentListStateV1 = 'active',
): Promise<ResearchDocumentSummaryV1[]> {
  const conversations = await getDatabase().agentConversation.findMany({
    where: {
      userId,
      surface: 'research',
      NOT: { researchDocument: { embeddedVersion: { isNot: null } } },
      archivedAt: state === 'archived' ? { not: null } : null,
    },
    include: {
      researchDocument: {
        select: { cells: { select: { status: true } } },
      },
      messages: {
        orderBy: { sequence: 'desc' },
        take: 1,
        select: { parts: true },
      },
    },
    orderBy: state === 'archived' ? { archivedAt: 'desc' } : { updatedAt: 'desc' },
  });
  return conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title ?? '',
    preview: messagePreview(conversation.messages[0]?.parts),
    cellCount: conversation.researchDocument?.cells.length ?? 0,
    staleCount:
      conversation.researchDocument?.cells.filter((cell) => cell.status === 'stale').length ?? 0,
    blockedCount:
      conversation.researchDocument?.cells.filter((cell) => cell.status === 'blocked').length ?? 0,
    archivedAt: conversation.archivedAt?.toISOString() ?? null,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  }));
}

/**
 * 加载归属当前用户的文档，首次读取时物化其历史会话。
 *
 * Load an owned document, materializing its legacy conversation on the first read.
 */
export async function getResearchDocument(
  userId: string,
  documentId: string,
): Promise<ResearchDocumentV1> {
  const owner = await getDatabase().agentConversation.findFirst({
    where: {
      id: documentId,
      userId,
      surface: 'research',
      archivedAt: null,
      NOT: { researchDocument: { embeddedVersion: { isNot: null } } },
    },
    select: { id: true, title: true, researchDocument: { select: { id: true } } },
  });
  if (!owner) {
    throw new ResearchError('document_not_found');
  }
  if (!owner.researchDocument) {
    const definition = legacyDefinition(owner.title ?? '');
    await getDatabase().researchDocument.create({
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
    throw new ResearchError('document_not_found');
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
  return getDatabase().researchDocument.findFirst({
    where: { id: documentId, userId, embeddedVersion: null },
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

/**
 * 组装文档、Cell 与执行控制状态，供客户端恢复完整工作台。
 *
 * Assemble document, cells and execution control state for client restoration.
 */
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
      (message): ChatMessage =>
        normalizeChatMessage({
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

/**
 * 将 Cell 持久化字段和输出映射为客户端视图。
 *
 * Map persisted cell fields and outputs into the client view.
 */
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

/**
 * 压缩消息片段作为文档列表预览，避免携带完整大产物。
 *
 * Summarize message parts for document list previews without copying large artifacts.
 */
function messagePreview(parts: Prisma.JsonValue | undefined): string {
  if (!Array.isArray(parts)) {
    return '';
  }
  for (const part of parts) {
    if (typeof part === 'object' && part !== null && !Array.isArray(part)) {
      if (part.type === 'text' && typeof part.text === 'string') {
        return part.text.slice(0, 80);
      }
      if (
        (part.type === 'research' || part.type === 'universe') &&
        typeof part.title === 'string'
      ) {
        return part.title.slice(0, 80);
      }
    }
  }
  return '';
}
