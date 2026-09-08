import type { Prisma } from '@prisma/client';
import { prisma } from '../../infra/database/prisma.js';
import type { ResearchExecutionSourceCellSnapshot } from '../evidence/execution-records.js';
import type { ResearchCellKindV1 } from '@jixie/shared';
import { jsonStringArray } from '../dependencies/cell-values.js';

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

export async function loadResearchExecutionSeed(userId: string, documentId: string) {
  const document = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId },
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
  };
}

export async function loadExecutableResearchCell(
  userId: string,
  cellId: string,
): Promise<ExecutableResearchCellRow | null> {
  return prisma.researchCell.findFirst({
    where: { id: cellId, document: { userId } },
    include: { document: { include: { conversation: true } } },
  });
}
