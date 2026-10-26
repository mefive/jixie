import type { AcceptCodeChangeRequest } from '@jixie/shared/api/factor';
import type { CodeChangeProposalV1 } from '@jixie/shared';
import type {
  CreateFactorDraftRequest,
  UpdateFactorDraftRequest,
  FactorMetadataRequest,
  PublishFactorRequest,
  FactorCompositeRequest,
  SubmitFactorAnalysisRequest,
  FactorCorrelationRequestQuery,
  SubmitFactorCorrelationRequest,
  FactorJobRequestQuery,
  FactorReportListRequestQuery,
  FactorAgentRequest,
  FactorAgentRequestParams,
  FactorQuestionRequest,
  FactorQuestionHistoryRequestQuery,
} from '@jixie/shared/api/factor';
import type {
  ChatMessage,
  LogLine,
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
  FactorStatus,
  PublishedFactor,
  RunFactorAnalysisResponse,
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

// —— Custom factors (code-first, Agent-authored) —— created on the first Agent prompt, then updated by
// id: messages in real time, code/name on an analysis run. Mirrors the strategy workbench.

/**
 * 提供因子编辑所需协议、身份和显示元数据。
 *
 * Supply protocol, identity and display metadata for factor editing.
 */
export interface CustomFactorMeta {
  id: string;
  name: string;
  key: string;
  language?: FactorLanguage;
  runtimeVersion?: FactorRuntimeVersion;
  status?: FactorStatus;
  updatedAt: string;
}

/**
 * 读取因子详情并转换为编辑器需要的定义与元数据。
 *
 * Read factor details and map them into editor definition and metadata.
 */
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
  builtin?: boolean; // preset rows are readable (readonly) through the same endpoint
  owned?: boolean;
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

/**
 * 提交新因子输入并返回持久化身份，供草稿编辑初始化。
 *
 * Submit factor creation input and return the persisted identity for draft editing.
 */
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
export function getFactorReports(factor: string): Promise<FactorReportListResponse> {
  const query = serializeQuery({
    factor,
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
): Promise<RunFactorAnalysisResponse> {
  return request('/api/app/factors/analyses', {
    method: 'POST',
    body: JSON.stringify({
      factor,
      spec,
    } satisfies SubmitFactorAnalysisRequest),
  });
}

/**
 * 描述分析任务身份及状态，供因子页面轮询。
 *
 * Describe analysis job identity and state for factor polling.
 */
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

export function acceptFactorCodeChange(
  factorId: string,
  proposalId: string,
  beforeCode: string,
): Promise<CodeChangeProposalV1> {
  return request(
    `/api/app/factors/${encodeURIComponent(factorId)}/code-change-proposals/${encodeURIComponent(proposalId)}/accept`,
    {
      method: 'POST',
      body: JSON.stringify({ beforeCode } satisfies AcceptCodeChangeRequest),
    },
  );
}
