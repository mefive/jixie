import type {
  CreateFactorDraftRequest,
  UpdateFactorDraftRequest,
  FactorMetadataRequest,
  PublishFactorRequest,
  FactorVisibilityRequest,
  FactorCompositeRequest,
  SubmitFactorAnalysisRequest,
  FactorCorrelationRequestQuery,
  SubmitFactorCorrelationRequest,
  FactorJobRequestQuery,
  FactorReportListRequestQuery,
  FactorResearchSummaryRequestQuery,
  CreateFactorWeatherPinRequest,
  FactorAgentRequest,
  FactorAgentRequestParams,
  FactorQuestionRequest,
  FactorQuestionHistoryRequestQuery,
} from '@jixie/shared/api/factor';
import type {
  ChatMessage,
  LogLine,
  AssetVisibility,
  ResearchFactorHandoffV1,
  FactorAnalysisKind,
  FactorMeta,
  FactorAnalysisSpec,
  FactorResearchSpecV1,
  FactorReportDetail,
  FactorReportListResponse,
  FactorFreq,
  FactorLanguage,
  FactorRuntimeVersion,
  FactorCorrelation,
  FactorCompositeDefinition,
  FactorCompositeResource,
  FactorHoldoutPolicyV1,
  FactorResearchIntentV1,
  FactorResearchSummary,
  FactorStatus,
  PublishedFactor,
  RunFactorAnalysisResponse,
  FactorWeatherDirection,
  FactorWeatherResponse,
  FactorQuestionTurnV1,
  FactorQuestionHistoryV1,
} from '@jixie/shared';
import { serializeQuery, request } from './client';

// Factor research: the factor list (identity + kind) — preset + this user's custom factors.
export function getFactorCatalog(): Promise<FactorMeta[]> {
  return request('/api/app/factors/catalog');
}

export function publishFactor(id: string, approvedReportId: string): Promise<PublishedFactor> {
  return request(`/api/app/factors/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    body: JSON.stringify({ approvedReportId } satisfies PublishFactorRequest),
  });
}

export function archiveFactor(id: string): Promise<PublishedFactor> {
  return request(`/api/app/factors/${encodeURIComponent(id)}/archive`, {
    method: 'POST',
  });
}

export function publishFactorComposite(
  id: string,
  approvedReportId: string,
): Promise<PublishedFactor> {
  return request(`/api/app/factors/composites/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    body: JSON.stringify({ approvedReportId } satisfies PublishFactorRequest),
  });
}

export function archiveFactorComposite(id: string): Promise<PublishedFactor> {
  return request(`/api/app/factors/composites/${encodeURIComponent(id)}/archive`, {
    method: 'POST',
  });
}

export function createFactorComposite(
  definition: FactorCompositeDefinition,
): Promise<FactorCompositeResource> {
  return request('/api/app/factors/composites', {
    method: 'POST',
    body: JSON.stringify({ definition } satisfies FactorCompositeRequest),
  });
}

export function getFactorComposite(id: string): Promise<FactorCompositeResource> {
  return request(`/api/app/factors/composites/${encodeURIComponent(id)}`);
}

export function updateFactorComposite(
  id: string,
  definition: FactorCompositeDefinition,
): Promise<FactorCompositeResource> {
  return request(`/api/app/factors/composites/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ definition } satisfies FactorCompositeRequest),
  });
}

export function deleteFactorComposite(id: string): Promise<{ ok: true }> {
  return request(`/api/app/factors/composites/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function copyFactorComposite(id: string): Promise<FactorCompositeResource> {
  return request(`/api/app/factors/composites/${encodeURIComponent(id)}/copy`, {
    method: 'POST',
  });
}

export function setFactorVisibility(
  id: string,
  kind: 'factor' | 'composite',
  visibility: AssetVisibility,
): Promise<{ id: string; visibility: AssetVisibility }> {
  const path =
    kind === 'composite' ? `composites/${encodeURIComponent(id)}` : encodeURIComponent(id);
  return request(`/api/app/factors/${path}/visibility`, {
    method: 'PATCH',
    body: JSON.stringify({ visibility } satisfies FactorVisibilityRequest),
  });
}

// —— Custom factors (code-first, Agent-authored) —— created on the first Agent prompt, then updated by
// id: messages in real time, code/name on an analysis run. Mirrors the strategy workbench.
export interface CustomFactorMeta {
  id: string;
  name: string;
  key: string;
  language?: FactorLanguage;
  runtimeVersion?: FactorRuntimeVersion;
  status?: FactorStatus;
  updatedAt: string;
}

export function getCustomFactor(id: string): Promise<{
  id: string;
  name: string;
  analysisKind?: FactorAnalysisKind;
  targetAssetClasses?: Array<'equity' | 'fixed_income' | 'commodity'>;
  language?: FactorLanguage;
  runtimeVersion?: FactorRuntimeVersion;
  key: string;
  status?: FactorStatus;
  approvedReportId?: string | null;
  codeHash?: string | null;
  publishedAt?: string | null;
  archivedAt?: string | null;
  strategyKey?: string;
  description?: string;
  code: string;
  messages?: ChatMessage[] | null;
  researchHandoff?: ResearchFactorHandoffV1 | null;
  sourceResearchExecution?: {
    id: string;
    documentId: string;
    title: string;
    displayName: string | null;
    sequence: number;
    promotedAt: string | null;
  } | null;
  builtin?: boolean; // preset rows are readable (readonly) through the same endpoint
  owned?: boolean;
  visibility?: AssetVisibility;
}> {
  return request(`/api/app/factors/${id}`);
}

// Copy a factor snapshot into a new independent draft.
export function copyFactor(
  id: string,
): Promise<{ id: string; key: string; name: string; status: 'draft' }> {
  return request(`/api/app/factors/${id}/copy`, { method: 'POST' });
}

// Create a NEW factor row (up front on the first Agent prompt / first run of a hand-written one).
export function createFactor(
  key: string,
  name: string,
  code: string,
  analysisKind: Extract<
    FactorAnalysisKind,
    'cross_sectional' | 'time_series' | 'panel'
  > = 'cross_sectional',
  messages?: CreateFactorDraftRequest['messages'],
  language: FactorLanguage = 'typescript',
): Promise<{
  id: string;
  key: string;
  name: string;
  language: FactorLanguage;
  runtimeVersion: FactorRuntimeVersion;
  status: 'draft';
}> {
  const body = messages
    ? { key, name, code, analysisKind, language, messages }
    : { key, name, code, analysisKind, language };
  return request('/api/app/factors', {
    method: 'POST',
    body: JSON.stringify(body satisfies CreateFactorDraftRequest),
  });
}

// Update a factor by id. `{ messages }` = real-time chat save; `{ code, name }` = an analysis run's
// commit. Historical reports retain their frozen source snapshots when the code moves.
export function updateFactor(
  id: string,
  patch: UpdateFactorDraftRequest,
): Promise<{ id: string; name: string }> {
  return request(`/api/app/factors/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch satisfies UpdateFactorDraftRequest),
  });
}

export function deleteCustomFactor(id: string): Promise<{ ok: true }> {
  return request(`/api/app/factors/${id}`, { method: 'DELETE' });
}

// Factor Agent: START one turn (iterates on the defineFactor code; history lives on the factor row).
export function sendFactorAgent(
  factorId: FactorAgentRequestParams['factorId'],
  message: string,
  code: string,
  analysis?: Pick<FactorAgentRequest, 'reportId' | 'dataReferences'>,
): Promise<{ turnId: string }> {
  return request(`/api/app/factors/${encodeURIComponent(factorId)}/agent/turns`, {
    method: 'POST',
    body: JSON.stringify({ message, code, ...analysis } satisfies FactorAgentRequest),
  });
}

// Question history is private to the current user and a stable Factor catalog identity.
export function factorQa(
  input: FactorQuestionRequest,
  signal?: AbortSignal,
): Promise<FactorQuestionTurnV1> {
  return request('/api/app/factors/questions', {
    method: 'POST',
    body: JSON.stringify(input satisfies FactorQuestionRequest),
    signal,
  });
}

export function getFactorQuestions(
  factorKey: string,
  before?: number,
  signal?: AbortSignal,
): Promise<FactorQuestionHistoryV1> {
  const query = serializeQuery({
    ...(before !== undefined ? { before: String(before) } : {}),
  } satisfies FactorQuestionHistoryRequestQuery);
  return request(`/api/app/factors/${encodeURIComponent(factorKey)}/questions?${query}`, {
    signal,
  });
}

export function refreshFactorMetadata(id: string, code: string): Promise<{ ok: true }> {
  return request(`/api/app/factors/${encodeURIComponent(id)}/metadata/refresh`, {
    method: 'POST',
    body: JSON.stringify({ code } satisfies FactorMetadataRequest),
  });
}

// Immutable report history. Full payloads and frozen source only come from the detail endpoint.
export function getFactorReports(
  factor: string,
  limit = 50,
  cursor?: string,
): Promise<FactorReportListResponse> {
  const query = serializeQuery({
    factor,
    limit: String(limit),
    ...(cursor ? { cursor } : {}),
  } satisfies FactorReportListRequestQuery);
  return request(`/api/app/factors/analysis-reports?${query}`);
}

export function getFactorReport(reportId: string): Promise<FactorReportDetail> {
  return request(`/api/app/factors/analysis-reports/${encodeURIComponent(reportId)}`);
}

// Every terminal re-run creates a new immutable report. Only an identical running variant is reused.
export function runFactorAnalysis(
  factor: string,
  spec: FactorAnalysisSpec | FactorResearchSpecV1,
  researchIntent: FactorResearchIntentV1,
  parentReportId?: string | null,
): Promise<RunFactorAnalysisResponse> {
  return request('/api/app/factors/analyses', {
    method: 'POST',
    body: JSON.stringify({
      factor,
      spec,
      parentReportId: parentReportId ?? null,
      researchIntent,
    } satisfies SubmitFactorAnalysisRequest),
  });
}

export function getFactorResearchWindow(): Promise<FactorHoldoutPolicyV1> {
  return request('/api/app/factors/research/window');
}

export function getFactorResearchSummary(factor?: string): Promise<FactorResearchSummary> {
  const parameters = serializeQuery({
    ...(factor ? { factor } : {}),
  } satisfies FactorResearchSummaryRequestQuery);
  const query = parameters ? `?${parameters}` : '';
  return request(`/api/app/factors/research/summary${query}`);
}

export function runFactorHoldout(reportId: string): Promise<RunFactorAnalysisResponse> {
  return request(`/api/app/factors/analysis-reports/${encodeURIComponent(reportId)}/holdout`, {
    method: 'POST',
  });
}

export function revealFactorHoldout(reportId: string): Promise<FactorReportDetail> {
  return request(`/api/app/factors/analysis-reports/${encodeURIComponent(reportId)}/reveal`, {
    method: 'POST',
  });
}

export interface FactorJob {
  status: 'queued' | 'running' | 'done' | 'error' | 'stale';
  queuePosition?: number;
  factorReportId?: string | null;
  logs: LogLine[];
  nextSince: number;
  error?: string | null;
}

export function pollFactorAnalysisJob(jobId: string, since = 0): Promise<FactorJob> {
  const query = serializeQuery({ since: String(since) } satisfies FactorJobRequestQuery);
  return request(`/api/app/factors/analysis-jobs/${encodeURIComponent(jobId)}?${query}`);
}

// —— Correlation matrix (3.4): 2–8 factors × a fixed size column ——

export function getFactorCorrelation(
  keys: string[],
  freq: FactorFreq,
  start: string,
  end: string,
): Promise<FactorCorrelation> {
  const query = serializeQuery({
    keys: keys.join(','),
    freq,
    start,
    end,
  } satisfies FactorCorrelationRequestQuery);
  return request(`/api/app/factors/correlations?${query}`);
}

export function runFactorCorrelation(
  keys: string[],
  freq: FactorFreq,
  start: string,
  end: string,
  refresh = false,
): Promise<{ done: true; report: FactorCorrelation } | { jobId: string }> {
  return request('/api/app/factors/correlations', {
    method: 'POST',
    body: JSON.stringify({
      keys,
      freq,
      start,
      end,
      refresh,
    } satisfies SubmitFactorCorrelationRequest),
  });
}

export function findActiveFactorCorrelationJob(
  keys: string[],
  freq: FactorFreq,
  start: string,
  end: string,
): Promise<{ jobId: string } | null> {
  const query = serializeQuery({
    keys: keys.join(','),
    freq,
    start,
    end,
  } satisfies FactorCorrelationRequestQuery);
  return request(`/api/app/factors/correlation-jobs/active?${query}`);
}

export function pollFactorCorrelationJob(jobId: string, since = 0): Promise<FactorJob> {
  const query = serializeQuery({ since: String(since) } satisfies FactorJobRequestQuery);
  return request(`/api/app/factors/correlation-jobs/${encodeURIComponent(jobId)}?${query}`);
}

// —— Factor weather: immutable pinned factors with offline monthly observations ——

export function getFactorWeather(): Promise<FactorWeatherResponse> {
  return request('/api/app/factors/weather');
}

export function pinFactorWeather(
  factorId: string,
  direction?: FactorWeatherDirection,
): Promise<{ id: string; status: string }> {
  return request('/api/app/factors/weather/pins', {
    method: 'POST',
    body: JSON.stringify({ factorId, direction } satisfies CreateFactorWeatherPinRequest),
  });
}

export function refreshFactorWeatherPin(id: string): Promise<{ id: string; status: string }> {
  return request(`/api/app/factors/weather/pins/${encodeURIComponent(id)}/refresh`, {
    method: 'POST',
  });
}

export function unpinFactorWeather(id: string): Promise<{ ok: true }> {
  return request(`/api/app/factors/weather/pins/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
