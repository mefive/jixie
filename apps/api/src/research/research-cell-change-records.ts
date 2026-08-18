import {
  Prisma,
  type ResearchCellChangeProposal as ResearchCellChangeProposalRow,
} from '@prisma/client';
import type {
  MessagePart,
  ResearchCellChangeConflictV1,
  ResearchCellChangeOperationV1,
  ResearchCellChangePart,
  ResearchCellChangeProposalStatusV1,
  ResearchCellChangeProposalV1,
} from '@jixie/shared';

interface PersistResearchCellChangePartArgs {
  conversationId: string;
  messageId: string;
  turnId?: string;
  userId: string;
  partIndex: number;
  part: ResearchCellChangePart;
}

/** Materialize a server-authored proposal only when its assistant message is committed. */
export async function persistResearchCellChangePart(
  transaction: Prisma.TransactionClient,
  args: PersistResearchCellChangePartArgs,
): Promise<ResearchCellChangePart> {
  if (!args.turnId) {
    throw new Error('Research Cell change proposals require a source Agent turn.');
  }
  const existing = await transaction.researchCellChangeProposal.findUnique({
    where: {
      sourceMessageId_sourcePartIndex: {
        sourceMessageId: args.messageId,
        sourcePartIndex: args.partIndex,
      },
    },
  });
  if (existing) {
    return { type: 'research_cell_change', proposal: researchCellChangeProposalView(existing) };
  }

  const document = await transaction.researchDocument.findFirst({
    where: {
      id: args.part.proposal.documentId,
      conversationId: args.conversationId,
      userId: args.userId,
    },
    select: { id: true },
  });
  if (!document) {
    throw new Error('Research document for Cell change proposal was not found.');
  }

  const proposal = args.part.proposal;
  const created = await transaction.researchCellChangeProposal.create({
    data: {
      id: proposal.id,
      documentId: document.id,
      sourceTurnId: args.turnId,
      sourceMessageId: args.messageId,
      sourcePartIndex: args.partIndex,
      title: proposal.title,
      summary: proposal.summary,
      expectedDocumentUpdatedAt: new Date(proposal.expectedDocumentUpdatedAt),
      ...(proposal.expectedDocumentContentRevision !== undefined
        ? { expectedDocumentContentRevision: proposal.expectedDocumentContentRevision }
        : {}),
      operations: proposal.operations as unknown as Prisma.InputJsonValue,
      status: 'pending',
      createdAt: new Date(proposal.createdAt),
    },
  });
  return { type: 'research_cell_change', proposal: researchCellChangeProposalView(created) };
}

export async function resolveResearchCellChangeProposalRecord(
  transaction: Prisma.TransactionClient,
  args: {
    proposalId: string;
    status: Exclude<ResearchCellChangeProposalStatusV1, 'pending'>;
    conflict?: ResearchCellChangeConflictV1;
    resolvedAt: Date;
  },
): Promise<ResearchCellChangeProposalV1> {
  const proposal = await transaction.researchCellChangeProposal.update({
    where: { id: args.proposalId },
    data: {
      status: args.status,
      conflict: args.conflict ? (args.conflict as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      resolvedAt: args.resolvedAt,
    },
  });
  const sourceMessage = await transaction.agentMessage.findUnique({
    where: { id: proposal.sourceMessageId },
    select: { parts: true },
  });
  if (!sourceMessage || !Array.isArray(sourceMessage.parts)) {
    throw new Error('Research Cell change proposal source message was not found.');
  }

  const view = researchCellChangeProposalView(proposal);
  const parts = [...(sourceMessage.parts as unknown as MessagePart[])];
  const sourcePart = parts[proposal.sourcePartIndex];
  if (sourcePart?.type !== 'research_cell_change' || sourcePart.proposal.id !== proposal.id) {
    throw new Error('Research Cell change proposal source part does not match its record.');
  }
  parts[proposal.sourcePartIndex] = { type: 'research_cell_change', proposal: view };
  await transaction.agentMessage.update({
    where: { id: proposal.sourceMessageId },
    data: { parts: parts as unknown as Prisma.InputJsonValue },
  });
  return view;
}

export function researchCellChangeProposalView(
  proposal: ResearchCellChangeProposalRow,
): ResearchCellChangeProposalV1 {
  return {
    version: 1,
    id: proposal.id,
    documentId: proposal.documentId,
    title: proposal.title,
    summary: proposal.summary,
    status: proposal.status as ResearchCellChangeProposalStatusV1,
    expectedDocumentUpdatedAt: proposal.expectedDocumentUpdatedAt.toISOString(),
    ...(proposal.expectedDocumentContentRevision != null
      ? { expectedDocumentContentRevision: proposal.expectedDocumentContentRevision }
      : {}),
    operations: proposal.operations as unknown as ResearchCellChangeOperationV1[],
    ...(proposal.conflict
      ? { conflict: proposal.conflict as unknown as ResearchCellChangeConflictV1 }
      : {}),
    createdAt: proposal.createdAt.toISOString(),
    ...(proposal.resolvedAt ? { resolvedAt: proposal.resolvedAt.toISOString() } : {}),
  };
}
