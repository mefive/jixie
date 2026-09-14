import { createHash } from 'node:crypto';
import type { ResearchEmbeddedDocumentSourceV1 } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import { researchPayloadHash } from '../evidence/fingerprints.js';
import type { ResearchRequestFrame } from './protocol.js';
import type { ResearchResponse } from './dispatch.js';

/** Retained mode never falls through to live loaders, including for an edited SDK request. */
export async function replayResearchInput(
  documentId: string,
  frame: ResearchRequestFrame,
): Promise<ResearchResponse | undefined> {
  const document = await prisma.researchDocument.findUnique({
    where: { id: documentId },
    select: { userId: true, embeddedSource: true },
  });
  const source = document?.embeddedSource as unknown as ResearchEmbeddedDocumentSourceV1 | null;
  if (!source || source.inputMode === 'current') {
    return undefined;
  }
  const run = await prisma.researchExecution.findFirst({
    where: {
      id: source.runId,
      embeddedVersionId: source.versionId,
      status: 'success',
      embeddedVersion: { analysisId: source.analysisId, analysis: { userId: document!.userId } },
    },
    select: { inputs: { where: { method: frame.method }, orderBy: { sequence: 'asc' } } },
  });
  if (!run) {
    throw new Error('The retained input source is unavailable. No current data was queried.');
  }
  const matches = run.inputs.filter(
    (input) => researchPayloadHash(input.arguments) === researchPayloadHash(frame.arguments),
  );
  const input = matches[0];
  if (!input?.responseJson || matches.some((match) => match.sha256 !== input.sha256)) {
    return {
      error:
        'This SDK request has no unambiguous retained response. Restore its original arguments or explicitly select current data in Research. No current data was queried.',
    };
  }
  if (createHash('sha256').update(input.responseJson).digest('hex') !== input.sha256) {
    throw new Error('Retained input checksum mismatch. No current data was queried.');
  }
  return JSON.parse(input.responseJson) as ResearchResponse;
}
