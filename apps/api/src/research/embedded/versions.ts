import type { Prisma, ResearchEmbeddedAnalysis } from '@prisma/client';
import type {
  ResearchEmbeddedContextV1,
  ResearchEmbeddedDraftInputV1,
  ResearchEmbeddedHostV1,
  ResearchEmbeddedParametersV1,
} from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '#infra/database/prisma.js';
import { captureEmbeddedContext } from './context.js';
import { ResearchEmbeddedError } from './errors.js';
import {
  embeddedCreateSchema,
  embeddedDraftSchema,
  embeddedUpdateSchema,
  embeddedDeriveSchema,
} from './contracts.js';
import { analysisView, versionView } from './views.js';

export async function createEmbeddedAnalysis(
  userId: string,
  raw: ResearchEmbeddedDraftInputV1 & { host: ResearchEmbeddedHostV1; title: string },
  capturedContext?: ResearchEmbeddedContextV1,
) {
  const input = embeddedCreateSchema.parse(raw);
  return prisma.$transaction(async (transaction) => {
    const analysis = await transaction.researchEmbeddedAnalysis.create({
      data: {
        id: ulid(),
        userId,
        hostType: input.host.type,
        hostId: input.host.id,
        title: input.title,
      },
    });
    const version = await createVersion(
      transaction,
      analysis,
      input,
      undefined,
      undefined,
      capturedContext,
    );
    return { analysis: analysisView(analysis), version: versionView(version) };
  });
}

export async function deriveEmbeddedVersion(
  userId: string,
  analysisId: string,
  raw: { parentVersionId: string; draft?: ResearchEmbeddedDraftInputV1 },
  capturedContext?: ResearchEmbeddedContextV1,
) {
  const input = embeddedDeriveSchema.parse(raw);
  return prisma.$transaction(async (transaction) => {
    const analysis = await ownedAnalysis(transaction, userId, analysisId);
    const parent = await transaction.researchEmbeddedAnalysisVersion.findFirst({
      where: { id: input.parentVersionId, analysisId },
    });
    if (!parent) {
      throw new ResearchEmbeddedError('not_found');
    }
    const version = await createVersion(
      transaction,
      analysis,
      input.draft ?? {
        source: parent.source,
        parameters: parent.parameters as ResearchEmbeddedParametersV1,
        inputScope: parent.inputScope,
      },
      parent.id,
      input.draft ? undefined : parent.contextSnapshot,
      capturedContext,
    );
    return versionView(version);
  });
}

export async function updateEmbeddedVersion(
  userId: string,
  analysisId: string,
  versionId: string,
  raw: ResearchEmbeddedDraftInputV1 & { expectedRevision: number },
  capturedContext?: ResearchEmbeddedContextV1,
) {
  const input = embeddedUpdateSchema.parse(raw);
  return prisma.$transaction(async (transaction) => {
    const analysis = await ownedAnalysis(transaction, userId, analysisId);
    const version = await transaction.researchEmbeddedAnalysisVersion.findFirst({
      where: { id: versionId, analysisId },
    });
    if (!version) {
      throw new ResearchEmbeddedError('not_found');
    }
    if (version.frozenAt) {
      throw new ResearchEmbeddedError('frozen');
    }
    if (analysis.activeRunId) {
      throw new ResearchEmbeddedError('run_in_progress');
    }
    if (version.revision !== input.expectedRevision) {
      throw new ResearchEmbeddedError('revision_conflict');
    }
    const context = await captureEmbeddedContext(
      transaction,
      userId,
      { type: analysis.hostType as ResearchEmbeddedHostV1['type'], id: analysis.hostId },
      input.reportId,
    );
    const updated = await transaction.researchEmbeddedAnalysisVersion.update({
      where: { id: versionId, revision: input.expectedRevision, frozenAt: null },
      data: {
        source: input.source,
        parameters: input.parameters,
        inputScope: input.inputScope,
        contextSnapshot: (capturedContext ?? context) as unknown as Prisma.InputJsonValue,
        revision: { increment: 1 },
      },
    });
    await transaction.researchCell.updateMany({
      where: { documentId: version.documentId },
      data: {
        source: input.source,
        config: { parameters: input.parameters },
        revision: updated.revision,
        status: 'idle',
      },
    });
    await transaction.researchDocument.update({
      where: { id: version.documentId },
      data: { contentRevision: updated.revision },
    });
    await transaction.researchEmbeddedAnalysis.update({
      where: { id: analysisId },
      data: { updatedAt: new Date() },
    });
    return versionView(updated);
  });
}

export async function ownedAnalysis(
  transaction: Prisma.TransactionClient,
  userId: string,
  analysisId: string,
) {
  const analysis = await transaction.researchEmbeddedAnalysis.findFirst({
    where: { id: analysisId, userId },
  });
  if (!analysis) {
    throw new ResearchEmbeddedError('not_found');
  }
  return analysis;
}

async function createVersion(
  transaction: Prisma.TransactionClient,
  analysis: ResearchEmbeddedAnalysis,
  raw: ResearchEmbeddedDraftInputV1,
  parentVersionId?: string,
  inheritedContext?: Prisma.JsonValue,
  capturedContext?: ResearchEmbeddedContextV1,
) {
  const input = embeddedDraftSchema.parse({
    source: raw.source,
    parameters: raw.parameters,
    inputScope: raw.inputScope,
    reportId: raw.reportId,
  });
  const context =
    inheritedContext ??
    (await captureEmbeddedContext(
      transaction,
      analysis.userId,
      { type: analysis.hostType as ResearchEmbeddedHostV1['type'], id: analysis.hostId },
      input.reportId,
    ));
  const allocated = await transaction.researchEmbeddedAnalysis.update({
    where: { id: analysis.id },
    data: { nextVersion: { increment: 1 } },
  });
  const documentId = ulid();
  await transaction.agentConversation.create({
    data: { id: documentId, userId: analysis.userId, surface: 'research', title: analysis.title },
  });
  await transaction.researchDocument.create({
    data: {
      id: documentId,
      userId: analysis.userId,
      conversationId: documentId,
      cells: {
        create: {
          id: ulid(),
          position: 0,
          kind: 'python',
          source: input.source,
          config: { parameters: input.parameters },
          definitions: [],
          references: [],
        },
      },
    },
  });
  return transaction.researchEmbeddedAnalysisVersion.create({
    data: {
      id: ulid(),
      analysisId: analysis.id,
      documentId,
      number: allocated.nextVersion - 1,
      parentVersionId,
      source: input.source,
      parameters: input.parameters,
      inputScope: input.inputScope,
      contextSnapshot: (capturedContext ?? context) as unknown as Prisma.InputJsonValue,
    },
  });
}
