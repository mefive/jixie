import type {
  Prisma,
  ResearchEmbeddedAnalysis,
  ResearchEmbeddedAnalysisVersion,
} from '@prisma/client';
import type {
  ResearchEmbeddedAnalysisV1,
  ResearchEmbeddedVersionV1,
  ResearchEmbeddedRunSummaryV1,
  ResearchEmbeddedContextV1,
  ResearchEmbeddedParametersV1,
} from '@jixie/shared';

export function analysisView(row: ResearchEmbeddedAnalysis): ResearchEmbeddedAnalysisV1 {
  return {
    version: 1,
    id: row.id,
    host: { type: row.hostType as 'factor' | 'strategy', id: row.hostId },
    title: row.title,
    activeRunId: row.activeRunId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function versionView(row: ResearchEmbeddedAnalysisVersion): ResearchEmbeddedVersionV1 {
  return {
    id: row.id,
    analysisId: row.analysisId,
    number: row.number,
    parentVersionId: row.parentVersionId,
    source: row.source,
    parameters: row.parameters as ResearchEmbeddedParametersV1,
    inputScope: row.inputScope,
    context: row.contextSnapshot as unknown as ResearchEmbeddedContextV1,
    revision: row.revision,
    frozenAt: row.frozenAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type EmbeddedRunRow = Prisma.ResearchExecutionGetPayload<{
  include: { job: true; embeddedVersion: true };
}>;

export function runSummaryView(row: EmbeddedRunRow): ResearchEmbeddedRunSummaryV1 {
  if (!row.embeddedVersion || !row.job) {
    throw new Error('Embedded run is missing its version or durable job');
  }
  return {
    analysisId: row.embeddedVersion.analysisId,
    versionId: row.embeddedVersion.id,
    runId: row.id,
    sequence: row.sequence,
    revision: row.contentRevision,
    jobId: row.job.id,
    status: row.status as ResearchEmbeddedRunSummaryV1['status'],
    sourceHash: row.sourceHash,
    errorCode: row.errorCode as ResearchEmbeddedRunSummaryV1['errorCode'],
    error: row.error,
    queuedAt: row.job.queuedAt.toISOString(),
    startedAt: row.job.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
