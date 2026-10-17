import type { Prisma } from '@prisma/client';
import { prisma } from '#infra/database/prisma.js';
import type { ResearchExecutionSourceCellSnapshot } from '../evidence/execution-records.js';
import type { ResearchCellKindV1 } from '@jixie/shared';
import { jsonStringArray } from '../dependencies/cell-values.js';

/**
 * 保留可执行 Cell 的源码、修订和依赖字段。
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
    embeddedSource?: Prisma.JsonValue | null;
    conversationId: string;
    conversation: { title: string | null; userId: string };
  };
}

/**
 * 读取并冻结待执行文档源码与修订身份，供可复现执行快照。
 * Load and freeze executable document sources and revisions for reproducible execution.
 */
export async function loadResearchExecutionSeed(userId: string, documentId: string) {
  const document = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId, embeddedVersion: null },
    select: {
      id: true,
      conversationId: true,
      runtimeVersion: true,
      contentRevision: true,
      embeddedSource: true,
      conversation: { select: { title: true, userId: true } },
      cells: { orderBy: { position: 'asc' } },
    },
  });
  if (!document) {
    return null;
  }
  const documentContext = {
    embeddedSource: document.embeddedSource,
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

/**
 * 将可执行 Cell 转换为独立源码快照，供不可变执行。
 * Map an executable cell into a detached execution source snapshot.
 */
export function researchExecutionSourceCellSnapshot(
  cell: ExecutableResearchCellRow,
): ResearchExecutionSourceCellSnapshot {
  return {
    id: cell.id,
    position: cell.position,
    kind: cell.kind as ResearchCellKindV1,
    source: cell.source,
    ...(cell.config ? { config: cell.config as Record<string, unknown> } : {}),
    revision: cell.revision,
    definitions: jsonStringArray(cell.definitions),
    references: jsonStringArray(cell.references),
    ...(cell.document.embeddedSource
      ? { inputSnapshot: cell.document.embeddedSource as Record<string, unknown> }
      : {}),
  };
}

export async function loadExecutableResearchCell(
  userId: string,
  cellId: string,
): Promise<ExecutableResearchCellRow | null> {
  return prisma.researchCell.findFirst({
    where: { id: cellId, document: { userId, embeddedVersion: null } },
    include: { document: { include: { conversation: true } } },
  });
}
