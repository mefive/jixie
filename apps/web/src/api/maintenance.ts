import { request } from './client';

import type {
  IngestionStatus,
  IngestionIssueList,
  IngestionIssueListQuery,
  IngestionCandidateReview,
  IngestionCandidatePublication,
  AcceptIngestionCandidateRequest,
  IngestionRunParams,
} from '@jixie/shared/api/ingestion';
export type { IngestionStatus } from '@jixie/shared/api/ingestion';

export function fetchIngestionStatus(): Promise<IngestionStatus> {
  return request('/api/ingestion/status');
}

export function fetchIngestionIssues(
  offset: number,
  signal: AbortSignal,
): Promise<IngestionIssueList> {
  const query = { offset: String(offset), limit: '20' } satisfies IngestionIssueListQuery;

  return request(`/api/ingestion/issues?${new URLSearchParams(query)}`, { signal });
}

export function fetchIngestionCandidate(
  runId: string,
  signal: AbortSignal,
): Promise<IngestionCandidateReview> {
  const params = { runId } satisfies IngestionRunParams;

  return request(`/api/ingestion/runs/${encodeURIComponent(params.runId)}`, {
    signal,
    cache: 'no-store',
  });
}

export function acceptIngestionCandidate(
  runId: string,
  input: AcceptIngestionCandidateRequest,
): Promise<IngestionCandidatePublication> {
  const params = { runId } satisfies IngestionRunParams;

  return request(`/api/ingestion/runs/${encodeURIComponent(params.runId)}/accept`, {
    method: 'POST',
    body: JSON.stringify(input satisfies AcceptIngestionCandidateRequest),
  });
}

/**
 * 标识已发布部署版本，供前端检测需要刷新。
 *
 * Identify a deployed release for client refresh detection.
 */
export interface DeploymentVersion {
  revision: string | null;
}

export function fetchDeploymentVersion(signal: AbortSignal): Promise<DeploymentVersion> {
  return request('/api/ingestion/version', { cache: 'no-store', signal });
}
