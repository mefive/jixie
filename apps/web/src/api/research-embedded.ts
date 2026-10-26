import type {
  UpdateResearchEmbeddedRequest,
  DeriveResearchEmbeddedRequest,
  RunResearchEmbeddedRequest,
  ResearchEmbeddedPageRequestQuery,
  ResearchEmbeddedListRequestQuery,
} from '@jixie/shared/api/research';
import type {
  ResearchEmbeddedAnalysisV1,
  ResearchEmbeddedVersionV1,
  ResearchEmbeddedRunV1,
  ResearchEmbeddedRunSummaryV1,
  ResearchEmbeddedHostV1,
  ResearchEmbeddedPageV1,
} from '@jixie/shared';
import { serializeQuery, request } from './client';

const embeddedApi = '/api/app/research/embedded-analyses';

export function listEmbeddedAnalyses(
  host: ResearchEmbeddedHostV1,
  cursor?: string,
  signal?: AbortSignal,
): Promise<ResearchEmbeddedPageV1<ResearchEmbeddedAnalysisV1>> {
  const query = serializeQuery({
    hostType: host.type,
    hostId: host.id,
    ...(cursor ? { cursor } : {}),
  } satisfies ResearchEmbeddedListRequestQuery);
  return request(`${embeddedApi}?${query}`, { signal });
}

export function readEmbeddedRun(
  analysisId: string,
  runId: string,
  signal?: AbortSignal,
): Promise<ResearchEmbeddedRunV1> {
  return request(
    `${embeddedApi}/${encodeURIComponent(analysisId)}/runs/${encodeURIComponent(runId)}`,
    { signal },
  );
}

/**
 * 序列化分页和取消选项，读取嵌入式运行历史。
 *
 * Load paginated embedded run history with cancellation options.
 */
export function listEmbeddedRuns(
  analysisId: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<ResearchEmbeddedPageV1<ResearchEmbeddedRunSummaryV1>> {
  const query = serializeQuery({
    ...(cursor ? { cursor } : {}),
  } satisfies ResearchEmbeddedPageRequestQuery);
  return request(
    `${embeddedApi}/${encodeURIComponent(analysisId)}/runs${query ? `?${query}` : ''}`,
    { signal },
  );
}

export function readEmbeddedVersion(
  analysisId: string,
  versionId: string,
  signal?: AbortSignal,
): Promise<ResearchEmbeddedVersionV1> {
  return request(
    `${embeddedApi}/${encodeURIComponent(analysisId)}/versions/${encodeURIComponent(versionId)}`,
    { signal },
  );
}

export function updateEmbeddedDraft(
  analysisId: string,
  versionId: string,
  input: UpdateResearchEmbeddedRequest,
): Promise<ResearchEmbeddedVersionV1> {
  return request(
    `${embeddedApi}/${encodeURIComponent(analysisId)}/versions/${encodeURIComponent(versionId)}`,
    { method: 'PATCH', body: JSON.stringify(input satisfies UpdateResearchEmbeddedRequest) },
  );
}

export function deriveEmbeddedDraft(
  analysisId: string,
  parentVersionId: string,
  draft: DeriveResearchEmbeddedRequest['draft'],
): Promise<ResearchEmbeddedVersionV1> {
  return request(`${embeddedApi}/${encodeURIComponent(analysisId)}/versions`, {
    method: 'POST',
    body: JSON.stringify({ parentVersionId, draft } satisfies DeriveResearchEmbeddedRequest),
  });
}

export function runEmbeddedDraft(
  analysisId: string,
  versionId: string,
  input: RunResearchEmbeddedRequest,
): Promise<ResearchEmbeddedRunSummaryV1> {
  return request(
    `${embeddedApi}/${encodeURIComponent(analysisId)}/versions/${encodeURIComponent(versionId)}/runs`,
    { method: 'POST', body: JSON.stringify(input satisfies RunResearchEmbeddedRequest) },
  );
}

export function stopEmbeddedRun(analysisId: string, runId: string): Promise<unknown> {
  return request(
    `${embeddedApi}/${encodeURIComponent(analysisId)}/runs/${encodeURIComponent(runId)}/cancel`,
    { method: 'POST' },
  );
}

export function continueEmbeddedResearch(
  analysisId: string,
  runId: string,
): Promise<{ documentId: string }> {
  return request(
    `${embeddedApi}/${encodeURIComponent(analysisId)}/runs/${encodeURIComponent(runId)}/continue-research`,
    { method: 'POST' },
  );
}

export function readEmbeddedAnalysis(
  analysisId: string,
  signal?: AbortSignal,
): Promise<ResearchEmbeddedAnalysisV1> {
  return request(`${embeddedApi}/${encodeURIComponent(analysisId)}`, { signal });
}
