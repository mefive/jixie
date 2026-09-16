import type { Prisma } from '@prisma/client';
import type { Locale, ResearchEmbeddedDocumentSourceV1 } from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '#infra/database/prisma.js';
import { t } from '#i18n/index.js';
import { getResearchDocument } from '../documents/read.js';
import { cellCreate } from '../documents/cell-seed.js';
import { closeResearchDocumentRuntime } from '../runtime/python-session.js';
import { startResearchDocumentRun, finishResearchDocumentRun } from '../document-runs/run-state.js';
import { assertNoOpenCellChangeReview } from '../proposals/review-state.js';
import { ResearchEmbeddedError } from './errors.js';

/** One editable copy per retained run. Repeated clicks return the same document. */
export async function continueEmbeddedResearch(
  userId: string,
  analysisId: string,
  runId: string,
  locale: Locale,
) {
  const documentId = await prisma.$transaction(async (transaction) => {
    const run = await transaction.researchExecution.findFirst({
      where: { id: runId, embeddedVersion: { analysisId, analysis: { userId } } },
      include: { embeddedVersion: { include: { analysis: true } }, inputs: true },
    });
    if (!run?.embeddedVersion) {
      throw new ResearchEmbeddedError('not_found');
    }
    if (run.status !== 'success' || run.inputs.some((input) => !input.responseJson)) {
      throw new ResearchEmbeddedError('incomplete_run');
    }
    const embeddedRunKey = `${userId}:${runId}`;
    const existing = await transaction.researchDocument.findUnique({ where: { embeddedRunKey } });
    if (existing) {
      await transaction.agentConversation.update({
        where: { id: existing.conversationId },
        data: { archivedAt: null },
      });
      return existing.id;
    }
    const source: ResearchEmbeddedDocumentSourceV1 = {
      analysisId,
      versionId: run.embeddedVersionId!,
      runId,
      title: run.title,
      inputMode: 'retained',
    };
    const snapshot = run.sourceSnapshot as unknown as {
      embedded: { source: string; inputScope: string };
    };
    const id = ulid();
    await transaction.agentConversation.create({
      data: { id, userId, surface: 'research', title: run.title },
    });
    await transaction.researchDocument.create({
      data: {
        id,
        userId,
        conversationId: id,
        embeddedRunKey,
        embeddedSource: source as unknown as Prisma.InputJsonValue,
        cells: {
          create: [
            cellCreate(
              {
                kind: 'markdown',
                source: t(locale, 'researchEmbeddedContinuationNote', {
                  title: run.title,
                  scope: snapshot.embedded.inputScope,
                  runId,
                }),
              },
              0,
            ),
            cellCreate(
              {
                kind: 'python',
                source: `parameters = {${Object.entries(
                  (run.parametersSnapshot as Record<string, unknown>) ?? {},
                )
                  .map(
                    ([key, value]) =>
                      `${JSON.stringify(key)}: ${value === null ? 'None' : value === true ? 'True' : value === false ? 'False' : JSON.stringify(value)}`,
                  )
                  .join(', ')}}`,
              },
              1,
            ),
            cellCreate({ kind: 'python', source: snapshot.embedded.source }, 2),
          ],
        },
      },
    });
    return id;
  });
  return { documentId };
}

export async function changeEmbeddedInputMode(
  userId: string,
  documentId: string,
  input: { inputMode: 'retained' | 'current'; expectedRevision: number },
) {
  const owned = await prisma.researchDocument.findFirst({
    where: { id: documentId, userId, embeddedVersion: null, conversation: { archivedAt: null } },
    select: { id: true },
  });
  if (!owned) {
    throw new ResearchEmbeddedError('not_found');
  }
  const control = startResearchDocumentRun(documentId);
  try {
    await assertNoOpenCellChangeReview(documentId);
    const changed = await prisma.$transaction(async (transaction) => {
      const document = await transaction.researchDocument.findFirst({
        where: {
          id: documentId,
          userId,
          embeddedVersion: null,
          conversation: { archivedAt: null },
        },
      });
      if (!document?.embeddedSource) {
        throw new ResearchEmbeddedError('not_found');
      }
      if (document.contentRevision !== input.expectedRevision) {
        throw new ResearchEmbeddedError('revision_conflict');
      }
      const source = document.embeddedSource as unknown as ResearchEmbeddedDocumentSourceV1;
      if (source.inputMode === input.inputMode) {
        return false;
      }
      await transaction.researchDocument.update({
        where: { id: documentId },
        data: {
          embeddedSource: { ...source, inputMode: input.inputMode },
          contentRevision: { increment: 1 },
        },
      });
      await transaction.researchCell.updateMany({
        where: { documentId, kind: 'python' },
        data: { status: 'stale', revision: { increment: 1 } },
      });
      return true;
    });
    if (changed) {
      closeResearchDocumentRuntime(documentId);
    }
    return getResearchDocument(userId, documentId);
  } finally {
    finishResearchDocumentRun(control);
  }
}
