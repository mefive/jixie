import { prisma } from '#infra/database/prisma.js';
import type { ResearchDocumentTemplateV1, ResearchDocumentV1 } from '@jixie/shared';
import { ulid } from 'ulid';
import { ResearchError } from '../errors.js';
import { closeResearchDocumentRuntime } from '../runtime/python-session.js';
import { templateDefinition } from '../templates/document-templates.js';
import { cellCreate } from './cell-seed.js';
import { getResearchDocument } from './read.js';

export async function archiveResearchDocument(
  userId: string,
  documentId: string,
): Promise<boolean> {
  const conversation = await prisma.agentConversation.findFirst({
    where: {
      id: documentId,
      userId,
      surface: 'research',
      NOT: { researchDocument: { embeddedVersion: { isNot: null } } },
    },
    select: { id: true, archivedAt: true },
  });
  if (!conversation) {
    throw new ResearchError('document_not_found');
  }
  if (!conversation.archivedAt) {
    await prisma.agentConversation.update({
      where: { id: conversation.id },
      data: { archivedAt: new Date() },
    });
  }
  closeResearchDocumentRuntime(documentId);
  return true;
}

export async function restoreResearchDocument(
  userId: string,
  documentId: string,
): Promise<boolean> {
  const conversation = await prisma.agentConversation.findFirst({
    where: {
      id: documentId,
      userId,
      surface: 'research',
      NOT: { researchDocument: { embeddedVersion: { isNot: null } } },
    },
    select: { id: true, archivedAt: true },
  });
  if (!conversation) {
    throw new ResearchError('document_not_found');
  }
  if (conversation.archivedAt) {
    await prisma.agentConversation.update({
      where: { id: conversation.id },
      data: { archivedAt: null },
    });
  }
  return true;
}

export async function createResearchDocument(
  userId: string,
  template: ResearchDocumentTemplateV1,
): Promise<ResearchDocumentV1> {
  const id = ulid();
  const definition = templateDefinition(template);
  await prisma.$transaction(async (transaction) => {
    await transaction.agentConversation.create({
      data: { id, userId, surface: 'research', title: definition.title },
    });
    await transaction.researchDocument.create({
      data: {
        id,
        userId,
        conversationId: id,
        cells: {
          create: definition.cells.map((cell, position) => cellCreate(cell, position)),
        },
      },
    });
  });
  return (await getResearchDocument(userId, id))!;
}

export async function renameResearchDocument(userId: string, documentId: string, title: string) {
  const updated = await prisma.agentConversation.updateMany({
    where: {
      id: documentId,
      userId,
      surface: 'research',
      NOT: { researchDocument: { embeddedVersion: { isNot: null } } },
      archivedAt: null,
    },
    data: { title },
  });
  if (updated.count !== 1) {
    throw new ResearchError('document_not_found');
  }
  return true;
}

export async function deleteResearchDocument(userId: string, documentId: string) {
  const deleted = await prisma.agentConversation.deleteMany({
    where: {
      id: documentId,
      userId,
      surface: 'research',
      NOT: { researchDocument: { embeddedVersion: { isNot: null } } },
    },
  });
  if (deleted.count === 1) {
    closeResearchDocumentRuntime(documentId);
  }
  if (deleted.count !== 1) {
    throw new ResearchError('document_not_found');
  }
  return true;
}
