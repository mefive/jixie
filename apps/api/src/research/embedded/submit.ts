import type { Prisma } from '@prisma/client';
import { RESEARCH_EMBEDDED_LIMITS } from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '#infra/database/prisma.js';
import { initializeJobLogs } from '#infra/jobs/logs.js';
import { wakeJobQueue } from '#infra/jobs/queue.js';
import { researchPayloadHash } from '../evidence/fingerprints.js';
import { ownedAnalysis } from './versions.js';
import { embeddedRunSchema } from './contracts.js';
import { ResearchEmbeddedError } from './errors.js';
import { runSummaryView } from './views.js';

export async function submitEmbeddedRun(
  userId: string,
  analysisId: string,
  versionId: string,
  raw: { requestId: string; expectedRevision: number },
) {
  const input = embeddedRunSchema.parse(raw);
  const result = await prisma.$transaction(async (transaction) => {
    const analysis = await ownedAnalysis(transaction, userId, analysisId);
    const version = await transaction.researchEmbeddedAnalysisVersion.findFirst({
      where: { id: versionId, analysisId },
      include: { document: { include: { cells: true } } },
    });
    if (!version) {
      throw new ResearchEmbeddedError('not_found');
    }
    const existing = await transaction.researchExecution.findUnique({
      where: {
        embeddedVersionId_requestId: { embeddedVersionId: versionId, requestId: input.requestId },
      },
      include: { job: true, embeddedVersion: true },
    });
    if (existing) {
      if (existing.contentRevision !== input.expectedRevision) {
        throw new ResearchEmbeddedError('request_conflict');
      }
      return { run: runSummaryView(existing), created: false };
    }
    if (version.revision !== input.expectedRevision) {
      throw new ResearchEmbeddedError('revision_conflict');
    }
    const runId = ulid();
    const claim = await transaction.researchEmbeddedAnalysis.updateMany({
      where: { id: analysisId, activeRunId: null },
      data: { activeRunId: runId },
    });
    if (claim.count !== 1) {
      throw new ResearchEmbeddedError('run_in_progress');
    }
    const cell = version.document.cells[0];
    if (!cell || version.document.cells.length !== 1 || cell.kind !== 'python') {
      throw new Error('Embedded version must contain exactly one Python cell');
    }
    const latest = await transaction.researchExecution.findFirst({
      where: { documentId: version.documentId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });
    const sourceSnapshot = {
      version: 1,
      embedded: {
        source: version.source,
        inputScope: version.inputScope,
        limits: RESEARCH_EMBEDDED_LIMITS,
      },
      cells: [
        {
          id: cell.id,
          position: 0,
          kind: 'python',
          source: cell.source,
          config: cell.config,
          revision: version.revision,
          definitions: [],
          references: [],
        },
      ],
    };
    const dagSnapshot = { version: 1, nodes: [{ cellId: cell.id, dependsOnCellIds: [] }] };
    const run = await transaction.researchExecution.create({
      data: {
        id: runId,
        documentId: version.documentId,
        embeddedVersionId: versionId,
        requestId: input.requestId,
        sequence: (latest?.sequence ?? 0) + 1,
        title: analysis.title,
        contentRevision: version.revision,
        runtimeVersion: version.document.runtimeVersion,
        status: 'queued',
        sourceSnapshot: sourceSnapshot as Prisma.InputJsonValue,
        dagSnapshot,
        executedCellIds: [],
        parametersSnapshot: version.parameters as Prisma.InputJsonValue,
        contextSnapshot: version.contextSnapshot as Prisma.InputJsonValue,
        sourceHash: researchPayloadHash({
          sourceSnapshot,
          dagSnapshot,
          parameters: version.parameters,
          context: version.contextSnapshot,
          runtimeVersion: version.document.runtimeVersion,
        }),
        cellExecutions: {
          create: {
            id: ulid(),
            documentId: version.documentId,
            cellId: cell.id,
            sourceCellId: cell.id,
            sourcePosition: 0,
            sourceKind: 'python',
            revision: version.revision,
            source: cell.source,
            status: 'queued',
            definitions: [],
            references: [],
            environmentFingerprint: 'pending',
          },
        },
        job: {
          create: {
            id: ulid(),
            userId,
            kind: 'research-embedded-analysis',
            key: analysisId,
            status: 'queued',
            payload: { runId },
          },
        },
      },
      include: { job: true, embeddedVersion: true },
    });
    return { run: runSummaryView(run), created: true };
  });
  if (result.created) {
    initializeJobLogs(result.run.jobId);
  }
  wakeJobQueue();
  return result.run;
}
