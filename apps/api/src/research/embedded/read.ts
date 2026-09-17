import { prisma } from '#infra/database/prisma.js';
import type {
  ResearchCellOutputBlockV1,
  ResearchEmbeddedContextV1,
  ResearchEmbeddedInputV1,
  ResearchEmbeddedPageV1,
  ResearchEmbeddedParametersV1,
  ResearchEmbeddedRunV1,
} from '@jixie/shared';
import { ResearchError } from '../errors.js';
import type { ResearchEmbeddedListQuery, ResearchEmbeddedPageQuery } from '../schema.js';
import { ownedAnalysis } from './versions.js';
import { analysisView, runSummaryView, versionView } from './views.js';

function page<T extends { id: string }, View>(
  rows: T[],
  limit: number,
  view: (row: T) => View,
): ResearchEmbeddedPageV1<View> {
  return {
    items: rows.slice(0, limit).map(view),
    nextCursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}

export async function listEmbeddedAnalyses(userId: string, input: ResearchEmbeddedListQuery) {
  const rows = await prisma.researchEmbeddedAnalysis.findMany({
    where: {
      userId,
      hostType: input.hostType,
      hostId: input.hostId,
      ...(input.cursor ? { id: { lt: input.cursor } } : {}),
    },
    orderBy: { id: 'desc' },
    take: input.limit + 1,
  });
  return page(rows, input.limit, analysisView);
}

export async function getEmbeddedAnalysis(userId: string, analysisId: string) {
  return analysisView(await ownedAnalysis(prisma, userId, analysisId));
}

export async function listEmbeddedVersions(
  userId: string,
  analysisId: string,
  input: ResearchEmbeddedPageQuery,
) {
  await ownedAnalysis(prisma, userId, analysisId);
  const cursor = input.cursor
    ? await prisma.researchEmbeddedAnalysisVersion.findFirst({
        where: { id: input.cursor, analysisId },
        select: { number: true },
      })
    : null;
  if (input.cursor && !cursor) {
    throw new ResearchError('embedded_not_found');
  }
  const rows = await prisma.researchEmbeddedAnalysisVersion.findMany({
    where: { analysisId, ...(cursor ? { number: { lt: cursor.number } } : {}) },
    orderBy: { number: 'desc' },
    take: input.limit + 1,
  });
  return page(rows, input.limit, versionView);
}

export async function getEmbeddedVersion(userId: string, analysisId: string, versionId: string) {
  const row = await prisma.researchEmbeddedAnalysisVersion.findFirst({
    where: { id: versionId, analysisId, analysis: { userId } },
  });
  if (!row) {
    throw new ResearchError('embedded_not_found');
  }
  return versionView(row);
}

export async function listEmbeddedRuns(
  userId: string,
  analysisId: string,
  input: ResearchEmbeddedPageQuery,
) {
  await ownedAnalysis(prisma, userId, analysisId);
  const rows = await prisma.researchExecution.findMany({
    where: {
      embeddedVersion: { analysisId },
      ...(input.cursor ? { id: { lt: input.cursor } } : {}),
    },
    include: { embeddedVersion: true, job: true },
    orderBy: { id: 'desc' },
    take: input.limit + 1,
  });
  return page(rows, input.limit, runSummaryView);
}

export async function getEmbeddedRun(
  userId: string,
  analysisId: string,
  runId: string,
): Promise<ResearchEmbeddedRunV1> {
  const row = await prisma.researchExecution.findFirst({
    where: { id: runId, embeddedVersion: { analysisId, analysis: { userId } } },
    include: {
      embeddedVersion: true,
      job: true,
      cellExecutions: { orderBy: { startedAt: 'asc' } },
      inputs: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          sequence: true,
          method: true,
          arguments: true,
          status: true,
          sha256: true,
          byteSize: true,
          rowCount: true,
          metadata: true,
          error: true,
          requestedAt: true,
          capturedAt: true,
        },
      },
    },
  });
  if (!row) {
    throw new ResearchError('embedded_not_found');
  }
  const snapshot = row.sourceSnapshot as unknown as {
    embedded: { source: string; inputScope: string; limits: ResearchEmbeddedRunV1['limits'] };
    cells: Array<{ source: string }>;
  };
  const continuation = await prisma.researchDocument.findUnique({
    where: { embeddedRunKey: `${userId}:${runId}` },
    select: { id: true },
  });
  return {
    ...runSummaryView(row),
    ...(continuation ? { researchDocumentId: continuation.id } : {}),
    source: snapshot.embedded.source,
    executedSource: snapshot.cells[0].source,
    inputScope: snapshot.embedded.inputScope,
    parameters: row.parametersSnapshot as ResearchEmbeddedParametersV1,
    context: row.contextSnapshot as unknown as ResearchEmbeddedContextV1,
    environment: row.environmentSnapshot as Record<string, unknown> | null,
    environmentFingerprint: row.environmentFingerprint,
    outputs: row.cellExecutions.flatMap((execution) =>
      Array.isArray(execution.output)
        ? (execution.output as unknown as ResearchCellOutputBlockV1[])
        : [],
    ),
    inputs: row.inputs.map(
      (input): ResearchEmbeddedInputV1 => ({
        ...input,
        arguments: input.arguments as Record<string, unknown>,
        metadata: (input.metadata as Record<string, unknown> | null) ?? {},
        status: input.status as ResearchEmbeddedInputV1['status'],
        requestedAt: input.requestedAt.toISOString(),
        capturedAt: input.capturedAt?.toISOString() ?? null,
      }),
    ),
    limits: snapshot.embedded.limits,
  };
}

export async function getEmbeddedInput(
  userId: string,
  analysisId: string,
  runId: string,
  inputId: string,
) {
  const input = await prisma.researchExecutionInput.findFirst({
    where: {
      id: inputId,
      executionId: runId,
      execution: { embeddedVersion: { analysisId, analysis: { userId } } },
    },
    select: { responseJson: true, sha256: true, byteSize: true },
  });
  if (!input) {
    throw new ResearchError('embedded_not_found');
  }
  return {
    response: input.responseJson ? (JSON.parse(input.responseJson) as unknown) : null,
    sha256: input.sha256,
    byteSize: input.byteSize,
  };
}
