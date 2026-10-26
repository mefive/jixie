import { getDatabase } from '#infra/database/prisma.js';
import {
  type ResearchCellOutputBlockV1,
  type ResearchEmbeddedPageV1,
  type ResearchEmbeddedParametersV1,
  type ResearchEmbeddedRunV1,
  RESEARCH_EMBEDDED_LIMITS,
} from '@jixie/shared';
import { ResearchError } from '../errors.js';
import type {
  ResearchEmbeddedListQuery,
  ResearchEmbeddedPageQuery,
} from '@jixie/shared/api/research';
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
  const rows = await getDatabase().researchEmbeddedAnalysis.findMany({
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
  return analysisView(await ownedAnalysis(getDatabase(), userId, analysisId));
}

export async function getEmbeddedVersion(userId: string, analysisId: string, versionId: string) {
  const row = await getDatabase().researchEmbeddedAnalysisVersion.findFirst({
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
  await ownedAnalysis(getDatabase(), userId, analysisId);
  const rows = await getDatabase().researchExecution.findMany({
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

/**
 * 校验运行访问权限并读取当前分析代码、输出及修订状态。
 *
 * Authorize an embedded run and read current analysis code, outputs and revision state.
 */
export async function getEmbeddedRun(
  userId: string,
  analysisId: string,
  runId: string,
): Promise<ResearchEmbeddedRunV1> {
  const row = await getDatabase().researchExecution.findFirst({
    where: { id: runId, embeddedVersion: { analysisId, analysis: { userId } } },
    include: {
      embeddedVersion: true,
      job: true,
      cellExecutions: { orderBy: { startedAt: 'asc' } },
    },
  });
  if (!row) {
    throw new ResearchError('embedded_not_found');
  }
  const continuation = await getDatabase().researchDocument.findUnique({
    where: { embeddedRunKey: `${userId}:${runId}` },
    select: { id: true },
  });
  return {
    ...runSummaryView(row),
    currentRevision: row.embeddedVersion!.revision,
    ...(continuation ? { researchDocumentId: continuation.id } : {}),
    source: row.embeddedVersion!.source,
    inputScope: row.embeddedVersion!.inputScope,
    parameters: row.embeddedVersion!.parameters as ResearchEmbeddedParametersV1,
    outputs: row.cellExecutions.flatMap((execution) =>
      Array.isArray(execution.output)
        ? (execution.output as unknown as ResearchCellOutputBlockV1[])
        : [],
    ),
    limits: RESEARCH_EMBEDDED_LIMITS,
  };
}
