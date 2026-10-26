import type { ResearchEmbeddedAnalysisJobPayload } from './job-payload.js';
import { getDatabase } from '#infra/database/prisma.js';
import { JobScheduler } from '#jobs/job-scheduler.js';
import { ulid } from 'ulid';
import { ResearchError } from '../errors.js';
import type { ResearchEmbeddedRunInput } from '@jixie/shared/api/research';
import { ownedAnalysis } from './versions.js';

import { runSummaryView } from './views.js';

/**
 * 校验实体归属与修订，保存临时 Job 输入并替换该版本的旧终态运行。
 *
 * Authorize the host and revision, save temporary Job input and replace this version’s previous terminal run.
 */
export async function submitEmbeddedRun(
  userId: string,
  analysisId: string,
  versionId: string,
  input: ResearchEmbeddedRunInput,
) {
  const result = await getDatabase().$transaction(async (transaction) => {
    await ownedAnalysis(transaction, userId, analysisId);
    const version = await transaction.researchEmbeddedAnalysisVersion.findFirst({
      where: { id: versionId, analysisId },
      include: { document: { include: { cells: true } } },
    });
    if (!version) {
      throw new ResearchError('embedded_not_found');
    }
    const existing = await transaction.researchExecution.findUnique({
      where: {
        embeddedVersionId_requestId: { embeddedVersionId: versionId, requestId: input.requestId },
      },
      include: { job: true, embeddedVersion: true },
    });
    if (existing) {
      if (existing.contentRevision !== input.expectedRevision) {
        throw new ResearchError('embedded_request_conflict');
      }
      return { run: runSummaryView(existing), created: false };
    }
    if (version.revision !== input.expectedRevision) {
      throw new ResearchError('embedded_revision_conflict');
    }
    const runId = ulid();
    const claim = await transaction.researchEmbeddedAnalysis.updateMany({
      where: { id: analysisId, activeRunId: null },
      data: { activeRunId: runId },
    });
    if (claim.count !== 1) {
      throw new ResearchError('embedded_run_in_progress');
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
    const previousRuns = await transaction.researchExecution.findMany({
      where: { embeddedVersionId: versionId, status: { notIn: ['queued', 'running'] } },
      select: { id: true },
    });
    const previousIds = previousRuns.map((run) => run.id);
    await transaction.researchCellExecution.deleteMany({
      where: { researchExecutionId: { in: previousIds } },
    });
    await transaction.researchExecution.deleteMany({ where: { id: { in: previousIds } } });

    const run = await transaction.researchExecution.create({
      data: {
        id: runId,
        documentId: version.documentId,
        embeddedVersionId: versionId,
        requestId: input.requestId,
        sequence: (latest?.sequence ?? 0) + 1,
        contentRevision: version.revision,
        status: 'queued',
        cellExecutions: {
          create: {
            id: ulid(),
            documentId: version.documentId,
            cellId: cell.id,
            sourceCellId: cell.id,
            sourcePosition: 0,
            sourceKind: 'python',
            revision: version.revision,
            status: 'queued',
            definitions: [],
            references: [],
          },
        },
        job: {
          create: {
            id: ulid(),
            userId,
            kind: 'research-embedded-analysis',
            key: analysisId,
            status: 'queued',
            payload: {
              runId,
              source: version.source,
              parameters: version.parameters as ResearchEmbeddedAnalysisJobPayload['parameters'],
              revision: version.revision,
            } satisfies ResearchEmbeddedAnalysisJobPayload,
          },
        },
      },
      include: { job: true, embeddedVersion: true },
    });
    return { run: runSummaryView(run), created: true };
  });
  JobScheduler.wake();
  return result.run;
}
