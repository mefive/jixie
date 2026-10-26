import type { Prisma } from '@prisma/client';
import { getDatabase } from '#infra/database/prisma.js';

/**
 * 保留可执行 Cell 的源码、修订和依赖字段。
 *
 * Describe executable cell source, revision and dependencies.
 */
export interface ExecutableResearchCellRow {
  id: string;
  documentId: string;
  position: number;
  kind: string;
  source: string;
  config: Prisma.JsonValue | null;
  status: string;
  revision: number;
  definitions: Prisma.JsonValue;
  references: Prisma.JsonValue;
  dependencyIssues: Prisma.JsonValue;
  lastExecutedRevision: number | null;
  document: {
    conversationId: string;
    conversation: { title: string | null; userId: string };
  };
}

/**
 * 读取待执行文档代码与修订，作为本次调用的内存输入。
 *
 * Load document code and revisions as in-memory input for this call.
 */
export async function loadResearchRunInput(userId: string, documentId: string) {
  const document = await getDatabase().researchDocument.findFirst({
    where: { id: documentId, userId, embeddedVersion: null },
    select: {
      id: true,
      conversationId: true,
      runtimeVersion: true,
      contentRevision: true,
      conversation: { select: { title: true, userId: true } },
      cells: { orderBy: { position: 'asc' } },
    },
  });
  if (!document) {
    return null;
  }
  const documentContext = {
    conversationId: document.conversationId,
    conversation: document.conversation,
  };
  return {
    title: document.conversation.title ?? '',
    runtimeVersion: document.runtimeVersion,
    contentRevision: document.contentRevision,
    cells: document.cells.map(
      (cell): ExecutableResearchCellRow => ({
        ...cell,
        document: documentContext,
      }),
    ),
  };
}

export async function loadExecutableResearchCell(
  userId: string,
  cellId: string,
): Promise<ExecutableResearchCellRow | null> {
  return getDatabase().researchCell.findFirst({
    where: { id: cellId, document: { userId, embeddedVersion: null } },
    include: { document: { include: { conversation: true } } },
  });
}
