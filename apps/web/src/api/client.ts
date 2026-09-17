// Thin frontend API wrapper. The backend uses a uniform error shape { error: { code, message, details? } },
// which we parse into an ApiError and throw; on success we return JSON.
// Sessions rely on an httpOnly cookie (same-origin via vite proxy), fetch sends the cookie by default, the frontend stores no token.
// Every request carries Accept-Language so the API localizes its user-facing messages and the agent replies in the user's language.

import type {
  EmailLoginRequest,
  VerifyEmailLoginRequest,
  DevelopmentLoginRequest,
} from '@jixie/shared/api/auth';
import type { AgentSqlRequest, ActiveAgentTurnRequestQuery } from '@jixie/shared/api/agent';
import type { ComputeChartRequest } from '@jixie/shared/api/chart';
import type {
  StrategyCodeConfigRequest,
  CreateStrategyRequest,
  UpdateStrategyRequest,
  StrategyVisibilityRequest,
  StrategyBacktestRequestParams,
  StrategyBacktestJobRequestQuery,
  StrategyScanRequestParams,
  StrategyScanJobRequestQuery,
  InspectStrategyParametersRequest,
  SubmitStrategyScanRequest,
  StrategyAgentRequest,
  StrategyAgentRequestParams,
} from '@jixie/shared/api/strategy';
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
  ResearchUniverseRequest,
  UpdateResearchEmbeddedRequest,
  DeriveResearchEmbeddedRequest,
  RunResearchEmbeddedRequest,
  ResearchEmbeddedPageRequestQuery,
  ResearchEmbeddedListRequestQuery,
  ResearchCuratorFindingRequest,
  ResearchDocumentListRequestQuery,
  CreateResearchDocumentRequest,
  CreateResearchCellRequest,
  UpdateResearchCellRequest,
  RenameResearchDocumentRequest,
  RunResearchDocumentRequest,
  PromoteResearchExecutionRequest,
  ResearchCellChangeReviewRequest,
  ResearchAgentRequest,
  ResearchDataCatalogRequestQuery,
  ResearchLanguageRequest,
  ResearchEmbeddedInputModeRequest,
} from '@jixie/shared/api/research';
import type {
  DeploymentListRequestQuery,
  ActualExecutionRequest,
  SignalRunListRequestQuery,
  SignalRunJobRequestQuery,
  CreateDeploymentRequest,
  SubmitSignalRunRequest,
} from '@jixie/shared/api/signals';
import type {
  InstrumentSeriesRequestQuery,
  InstrumentAssetTypeRequestParam,
  MarketStateRequestQuery,
  MarketWeatherRequestQuery,
  InstrumentNamesRequestQuery,
} from '@jixie/shared/api/market';

import { localeStore } from '@src/i18n/locale-store';
import i18n from '@src/i18n';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export interface MaintenanceStatus {
  active: boolean;
  runId: string | null;
  kind: 'daily' | 'weekly' | 'repair' | 'deploy' | null;
  startDate: string | null;
  endDate: string | null;
  completedDates: number;
  totalDates: number;
  lastSuccessfulDailyDate: string | null;
  stage: string | null;
  startedAt: string | null;
  heartbeatAt: string | null;
  error: string | null;
  retryAfterSeconds: number;
}

export class ApiError extends Error {
  public code: string;
  public field?: string;
  public details?: unknown;
  public status?: number;

  public constructor(code: string, message: string, details?: unknown, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.status = status;
    // The backend puts { field } in details for field-level errors; the login page uses it to focus the matching input
    if (details && typeof details === 'object' && 'field' in details) {
      this.field = (details as { field?: string }).field;
    }
  }
}

/** Serialize an already typed HTTP query without applying server defaults or coercion. */
function serializeQuery(query: Record<string, string | undefined>): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      parameters.set(key, value);
    }
  }
  return parameters.toString();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'accept-language': localeStore.locale,
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    notifyServiceUnavailable();
    throw new ApiError('SERVICE_UNAVAILABLE', i18n.t('common:errors.serviceUnavailable'));
  }

  const text = await res.text();
  let body: any;
  try {
    body = parseResponseBody(res, text);
  } catch (error) {
    if (isGatewayUnavailableStatus(res.status)) {
      notifyServiceUnavailable();
    }
    throw error;
  }

  if (!res.ok) {
    const err = body?.error;
    notifyMaintenance(err);
    if (err?.code !== 'MAINTENANCE' && isGatewayUnavailableStatus(res.status)) {
      notifyServiceUnavailable();
    }
    throw new ApiError(
      err?.code ?? 'UNKNOWN',
      err?.message ?? `${res.status} ${res.statusText}`,
      err?.details,
      res.status,
    );
  }
  return body as T;
}

function parseResponseBody(response: Response, text: string): any {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(
      'INVALID_RESPONSE',
      i18n.t('common:errors.serviceUnavailable'),
      {
        status: response.status,
        contentType: response.headers.get('content-type'),
      },
      response.status,
    );
  }
}

function isGatewayUnavailableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function notifyServiceUnavailable(): void {
  window.dispatchEvent(new Event('jixie:service-unavailable'));
}

export function fetchMaintenanceStatus(): Promise<MaintenanceStatus> {
  return request('/api/maintenance/status');
}

// Current auth state. The backend deliberately always returns 200: when not logged in it returns { user: null }
export function fetchMe(): Promise<{ user: AuthUser | null }> {
  return request('/api/auth/me');
}

export function devLogin(email: string): Promise<{ user: AuthUser }> {
  return request('/api/auth/dev/login', {
    method: 'POST',
    body: JSON.stringify({ email } satisfies DevelopmentLoginRequest),
  });
}

// Send code. A new email must include inviteCode; an existing email doesn't. A new email without a code returns VALIDATION_FAILED + field=inviteCode
export function requestEmailLogin(
  input: EmailLoginRequest,
): Promise<{ challengeId: string; expiresIn: number }> {
  return request('/api/auth/email/request', {
    method: 'POST',
    body: JSON.stringify(input satisfies EmailLoginRequest),
  });
}

// Verify code to log in / register. On success it writes the session cookie
export function verifyEmailLogin(input: VerifyEmailLoginRequest): Promise<{ user: AuthUser }> {
  return request('/api/auth/email/verify', {
    method: 'POST',
    body: JSON.stringify(input satisfies VerifyEmailLoginRequest),
  });
}

export function logout(): Promise<{ ok: true }> {
  return request('/api/auth/logout', { method: 'POST' });
}

// —— Backtest ——

import type {
  AgentStreamEvent,
  AgentTurnDetail,
  ActualExecutionUpdate,
  BacktestConfig,
  BacktestReportDetail,
  BacktestReportSummary,
  ChatMessage,
  ComputeChartSpec,
  LogLine,
  SqlRows,
  StrategyScanReport,
  StrategyScanReportSummary,
  StrategyScanSpec,
  StrategyParamValue,
  SignalRun,
  SignalTodayEntry,
  StrategyExecutionOverview,
  StrategyDeployment,
  ToolTraceItem,
  SharingCatalog,
  AssetVisibility,
  ResearchConversationMessages,
  ResearchCellKindV1,
  ResearchCellChangeRunResultV1,
  ResearchCellChangeResolutionResultV1,
  ResearchCellChangeReviewResolutionResultV1,
  ResearchClarificationSelectionV1,
  ResearchDocumentAnalysisV1,
  ResearchDocumentInterruptResultV1,
  ResearchDocumentListStateV1,
  ResearchDocumentRunResultV1,
  ResearchDocumentSummaryV1,
  ResearchDocumentTemplateV1,
  ResearchDocumentV1,
  ResearchExecutionSummaryV1,
  ResearchExecutionV1,
  ResearchFactorDraftResultV1,
  ResearchFactorHandoffV1,
  ResearchStrategyDraftResultV1,
  ResearchDataCatalogResultV1,
  ResearchDataCatalogScopeV1,
  ResearchAssetTypeV1,
  ResearchLanguageResultV1,
  ResearchCuratorFindingV1,
  ResearchCuratorRunV1,
} from '@jixie/shared';

// Back-compat alias — the trace item type now lives in shared (agent-stream protocol).
export type AgentToolTraceItem = ToolTraceItem;

// —— Agent turn streaming (SSE) ——
// Two-step, marginalia-style: the surface POST starts a background turn and returns a turnId; then
// GET /agent/turns/:id/stream subscribes. Any client can (re)attach at any time — the first frame is
// always a snapshot — which is what makes a page refresh resume the stream.

// Subscribe to a turn's SSE stream. `signal` cancels the SUBSCRIPTION only (the turn keeps running
// server-side); to stop the turn itself call cancelAgentTurn.
export async function subscribeAgentTurn(turnId: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(`/api/app/agent/turns/${turnId}/stream`, {
    signal,
    headers: { 'accept-language': localeStore.locale },
  });
  if (!res.ok) {
    const body = (await res.json().catch((): null => null)) as {
      error?: { code?: string; message?: string; details?: unknown };
    } | null;
    notifyMaintenance(body?.error);
    if (body?.error?.code !== 'MAINTENANCE' && isGatewayUnavailableStatus(res.status)) {
      notifyServiceUnavailable();
    }
    throw new ApiError(
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? `${res.status} ${res.statusText}`,
      body?.error?.details,
      res.status,
    );
  }
  return res;
}

function notifyMaintenance(error: { code?: string; details?: unknown } | null | undefined): void {
  if (error?.code === 'MAINTENANCE' && error.details) {
    window.dispatchEvent(
      new CustomEvent<MaintenanceStatus>('jixie:maintenance', {
        detail: error.details as MaintenanceStatus,
      }),
    );
  }
}

// The live turn for an entity ('strategy:<id>' | 'factor:<id>' | 'research:<id>') — refresh reattach.
export function findRunningAgentTurn(entityKey: string): Promise<{ turnId: string | null }> {
  const query = serializeQuery({ entity: entityKey } satisfies ActiveAgentTurnRequestQuery);
  return request(`/api/app/agent/turns/active?${query}`);
}

// Abort the upstream LLM (idempotent; already-finished turns are a no-op).
export function cancelAgentTurn(turnId: string): Promise<{ ok: true; cancelled: boolean }> {
  return request(`/api/app/agent/turns/${turnId}/cancel`, { method: 'POST' });
}

export function getAgentTurn(turnId: string): Promise<AgentTurnDetail> {
  return request(`/api/app/agent/turns/${turnId}`);
}

export function getAgentConversationMessages(
  conversationId: string,
): Promise<ResearchConversationMessages> {
  return request(`/api/app/agent/conversations/${encodeURIComponent(conversationId)}/messages`);
}

// —— Natural-language research ——

export function listResearchDocuments(
  state: ResearchDocumentListStateV1 = 'active',
): Promise<ResearchDocumentSummaryV1[]> {
  const query = serializeQuery({ state } satisfies ResearchDocumentListRequestQuery);
  return request(`/api/app/research/documents?${query}`);
}

export function createResearchDocument(
  template: ResearchDocumentTemplateV1,
): Promise<ResearchDocumentV1> {
  return request('/api/app/research/documents', {
    method: 'POST',
    body: JSON.stringify({ template } satisfies CreateResearchDocumentRequest),
  });
}

export function createResearchDocumentFromBacktestReport(
  reportId: string,
): Promise<ResearchDocumentV1> {
  return request('/api/app/research/documents', {
    method: 'POST',
    body: JSON.stringify({
      source: { type: 'backtest-report', reportId },
    } satisfies CreateResearchDocumentRequest),
  });
}

export function getResearchDocument(documentId: string): Promise<ResearchDocumentV1> {
  return request(`/api/app/research/documents/${encodeURIComponent(documentId)}`);
}

export function archiveResearchDocument(documentId: string): Promise<{ ok: true }> {
  return request(`/api/app/research/documents/${encodeURIComponent(documentId)}/archive`, {
    method: 'POST',
  });
}

export function restoreResearchDocument(documentId: string): Promise<{ ok: true }> {
  return request(`/api/app/research/documents/${encodeURIComponent(documentId)}/restore`, {
    method: 'POST',
  });
}

export function researchArtifactUrl(artifactId: string): string {
  return `/api/app/research/artifacts/${encodeURIComponent(artifactId)}`;
}

export function addResearchCell(
  documentId: string,
  kind: ResearchCellKindV1,
  source = '',
): Promise<ResearchDocumentV1> {
  return request(`/api/app/research/documents/${encodeURIComponent(documentId)}/cells`, {
    method: 'POST',
    body: JSON.stringify({ kind, source } satisfies CreateResearchCellRequest),
  });
}

export function updateResearchCell(
  cellId: string,
  patch: UpdateResearchCellRequest,
): Promise<ResearchDocumentV1> {
  return request(`/api/app/research/cells/${encodeURIComponent(cellId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch satisfies UpdateResearchCellRequest),
  });
}

export function deleteResearchCell(cellId: string): Promise<ResearchDocumentV1> {
  return request(`/api/app/research/cells/${encodeURIComponent(cellId)}`, { method: 'DELETE' });
}

export function runResearchCell(cellId: string): Promise<ResearchDocumentV1> {
  return request(`/api/app/research/cells/${encodeURIComponent(cellId)}/run`, { method: 'POST' });
}

export function runAffectedResearchCells(cellId: string): Promise<ResearchDocumentRunResultV1> {
  return request(`/api/app/research/cells/${encodeURIComponent(cellId)}/run-affected`, {
    method: 'POST',
  });
}

export function analyzeResearchDocument(documentId: string): Promise<ResearchDocumentAnalysisV1> {
  return request(
    `/api/app/research/documents/${encodeURIComponent(documentId)}/dependency-analysis`,
    {
      method: 'POST',
    },
  );
}

export function runResearchDocument(
  documentId: string,
  clean = true,
): Promise<ResearchDocumentRunResultV1> {
  return request(`/api/app/research/documents/${encodeURIComponent(documentId)}/run`, {
    method: 'POST',
    body: JSON.stringify({ clean } satisfies RunResearchDocumentRequest),
  });
}

export function listResearchExecutions(documentId: string): Promise<ResearchExecutionSummaryV1[]> {
  return request(`/api/app/research/documents/${encodeURIComponent(documentId)}/executions`);
}

export function getResearchExecution(executionId: string): Promise<ResearchExecutionV1> {
  return request(`/api/app/research/executions/${encodeURIComponent(executionId)}`);
}

export function promoteResearchExecution(
  executionId: string,
  input: PromoteResearchExecutionRequest,
): Promise<ResearchExecutionSummaryV1> {
  return request(`/api/app/research/executions/${encodeURIComponent(executionId)}/promote`, {
    method: 'POST',
    body: JSON.stringify(input satisfies PromoteResearchExecutionRequest),
  });
}

export function createResearchFactorDraft(
  executionId: string,
): Promise<ResearchFactorDraftResultV1> {
  return request(`/api/app/research/executions/${encodeURIComponent(executionId)}/factor-draft`, {
    method: 'POST',
  });
}

export function createResearchStrategyDraft(
  executionId: string,
): Promise<ResearchStrategyDraftResultV1> {
  return request(`/api/app/research/executions/${encodeURIComponent(executionId)}/strategy-draft`, {
    method: 'POST',
  });
}

export function interruptResearchDocument(
  documentId: string,
): Promise<ResearchDocumentInterruptResultV1> {
  return request(
    `/api/app/research/documents/${encodeURIComponent(documentId)}/runtime/interrupt`,
    {
      method: 'POST',
    },
  );
}

export function resetResearchDocument(documentId: string): Promise<ResearchDocumentV1> {
  return request(`/api/app/research/documents/${encodeURIComponent(documentId)}/runtime/reset`, {
    method: 'POST',
  });
}

export function applyResearchCellChangeProposal(
  proposalId: string,
): Promise<ResearchCellChangeResolutionResultV1> {
  return request(
    `/api/app/research/cell-change-proposals/${encodeURIComponent(proposalId)}/apply`,
    { method: 'POST' },
  );
}

export function applyResearchCellChangeProposalForReview(
  proposalId: string,
): Promise<ResearchCellChangeResolutionResultV1> {
  return request(
    `/api/app/research/cell-change-proposals/${encodeURIComponent(proposalId)}/review`,
    { method: 'POST' },
  );
}

export function acceptResearchCellChangeReview(
  proposalId: string,
  expectedContentRevision: number,
): Promise<ResearchCellChangeReviewResolutionResultV1> {
  return request(
    `/api/app/research/cell-change-proposals/${encodeURIComponent(proposalId)}/review/accept`,
    {
      method: 'POST',
      body: JSON.stringify({ expectedContentRevision } satisfies ResearchCellChangeReviewRequest),
    },
  );
}

export function revertResearchCellChangeReview(
  proposalId: string,
  expectedContentRevision: number,
): Promise<ResearchCellChangeReviewResolutionResultV1> {
  return request(
    `/api/app/research/cell-change-proposals/${encodeURIComponent(proposalId)}/review/revert`,
    {
      method: 'POST',
      body: JSON.stringify({ expectedContentRevision } satisfies ResearchCellChangeReviewRequest),
    },
  );
}

export function rejectResearchCellChangeProposal(
  proposalId: string,
): Promise<ResearchCellChangeResolutionResultV1> {
  return request(
    `/api/app/research/cell-change-proposals/${encodeURIComponent(proposalId)}/reject`,
    { method: 'POST' },
  );
}

export function runResearchCellChangeProposal(
  proposalId: string,
): Promise<ResearchCellChangeRunResultV1> {
  return request(
    `/api/app/research/cell-change-proposals/${encodeURIComponent(proposalId)}/attempts`,
    { method: 'POST' },
  );
}

export function requestResearchLanguage(
  input: ResearchLanguageRequest,
  signal?: AbortSignal,
): Promise<ResearchLanguageResultV1> {
  return request('/api/app/research/language/python', {
    method: 'POST',
    body: JSON.stringify(input satisfies ResearchLanguageRequest),
    signal,
  });
}

export function searchResearchDataCatalog(
  query: string,
  assetType?: ResearchAssetTypeV1,
  signal?: AbortSignal,
  scope: ResearchDataCatalogScopeV1 = 'instruments',
): Promise<ResearchDataCatalogResultV1> {
  const parameters = serializeQuery({
    q: query,
    scope,
    ...(assetType ? { assetType } : {}),
  } satisfies ResearchDataCatalogRequestQuery);
  return request(`/api/app/research/data-catalog?${parameters}`, { signal });
}

export function sendResearchAgent(
  message: string,
  conversationId?: string,
  attemptId?: string,
  contextCellIds: string[] = [],
): Promise<{ conversationId: string; turnId: string }> {
  return request('/api/app/research/agent/turns', {
    method: 'POST',
    body: JSON.stringify({
      message,
      ...(conversationId ? { conversationId } : {}),
      ...(attemptId ? { attemptId } : {}),
      ...(contextCellIds.length > 0 ? { contextCellIds } : {}),
    } satisfies ResearchAgentRequest),
  });
}

export function answerResearchClarification(
  conversationId: string,
  clarificationId: string,
  selections: ResearchClarificationSelectionV1[],
): Promise<{ conversationId: string; turnId: string }> {
  return request('/api/app/research/agent/turns', {
    method: 'POST',
    body: JSON.stringify({
      conversationId,
      clarificationAnswer: { clarificationId, selections },
    } satisfies ResearchAgentRequest),
  });
}

export function renameResearchDocument(documentId: string, title: string): Promise<{ ok: true }> {
  return request(`/api/app/research/documents/${encodeURIComponent(documentId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title } satisfies RenameResearchDocumentRequest),
  });
}

export function deleteResearchDocument(documentId: string): Promise<{ ok: true }> {
  return request(`/api/app/research/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  });
}

export function startResearchCurator(): Promise<ResearchCuratorRunV1> {
  return request('/api/app/research/curator/runs', { method: 'POST' });
}

export function getLatestResearchCuratorRun(): Promise<ResearchCuratorRunV1 | null> {
  return request('/api/app/research/curator/runs/latest');
}

export function getResearchCuratorRun(runId: string): Promise<ResearchCuratorRunV1> {
  return request(`/api/app/research/curator/runs/${encodeURIComponent(runId)}`);
}

export function updateResearchCuratorFinding(
  findingId: string,
  input: ResearchCuratorFindingRequest,
): Promise<ResearchCuratorFindingV1> {
  return request(`/api/app/research/curator/findings/${encodeURIComponent(findingId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input satisfies ResearchCuratorFindingRequest),
  });
}

// Read-only SQL over the market-table whitelist — chart cards re-run their persisted query here.
export function agentSql(sql: string): Promise<SqlRows> {
  return request('/api/app/agent/sql-queries', {
    method: 'POST',
    body: JSON.stringify({ sql } satisfies AgentSqlRequest),
  });
}

// Re-run a compute-source chart card (persisted queries + sandboxed transform → row table).
export function agentComputeChart(spec: ComputeChartSpec): Promise<SqlRows> {
  return request('/api/app/agent/chart-computations', {
    method: 'POST',
    body: JSON.stringify(spec satisfies ComputeChartRequest),
  });
}

// Parse an SSE body (hono streamSSE: `data: <json>\n\n` frames). fetch + ReadableStream instead of
// EventSource — EventSource can't attach an AbortSignal or read a failed response body.
export async function* readSSE(res: Response): AsyncGenerator<AgentStreamEvent> {
  if (!res.body) {
    throw new Error('SSE response has no body');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line; one event may carry several `data:` lines.
      let separator: number;
      while ((separator = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const dataLines = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''));
        if (dataLines.length === 0) {
          continue;
        }
        try {
          yield JSON.parse(dataLines.join('\n')) as AgentStreamEvent;
        } catch (e) {
          console.error('SSE parse failed', e, dataLines);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// A backtest Job (runs in a worker). Poll carries the log lines after `since` + `nextSince`. Status
// only — the result lands on BacktestReport and mirrors to Strategy.lastResult as the latest cache.
// 'stale' = the run's process died.
// Logs are tagged LogLine (system progress vs the strategy's own console.*).
export interface BacktestJob {
  status: 'queued' | 'running' | 'done' | 'error' | 'stale';
  queuePosition?: number;
  backtestReportId?: string | null;
  logs: LogLine[];
  nextSince: number;
  error?: string | null;
}

// Commit a saved strategy's runnable config and start its immutable report atomically.
export function submitBacktest(
  config: BacktestConfig,
  strategyId: StrategyBacktestRequestParams['strategyId'],
): Promise<{ jobId: string; reportId: string }> {
  return request(`/api/app/strategies/${encodeURIComponent(strategyId)}/backtests`, {
    method: 'POST',
    body: JSON.stringify(config satisfies StrategyCodeConfigRequest),
  });
}

// Poll a backtest job — `since` = how many log lines the client already has (incremental tail).
export function pollBacktest(jobId: string, since = 0): Promise<BacktestJob> {
  const query = serializeQuery({ since: String(since) } satisfies StrategyBacktestJobRequestQuery);
  return request(`/api/app/strategies/backtest-jobs/${encodeURIComponent(jobId)}?${query}`);
}

// Find a queued or running backtest and its report to reconnect after a refresh.
export function findActiveBacktestJob(
  strategyId: StrategyBacktestRequestParams['strategyId'],
): Promise<{ jobId: string; reportId: string } | null> {
  return request(`/api/app/strategies/${encodeURIComponent(strategyId)}/backtest-jobs/active`);
}

export function listBacktestReports(
  strategyId: StrategyBacktestRequestParams['strategyId'],
): Promise<BacktestReportSummary[]> {
  return request(`/api/app/strategies/${encodeURIComponent(strategyId)}/backtest-reports`);
}

export function getBacktestReport(reportId: string): Promise<BacktestReportDetail> {
  return request(`/api/app/strategies/backtest-reports/${encodeURIComponent(reportId)}`);
}

export function inspectStrategyParameters(
  code: string,
): Promise<{ parameters: Record<string, StrategyParamValue> }> {
  return request('/api/app/strategies/scan-parameters/inspect', {
    method: 'POST',
    body: JSON.stringify({ code } satisfies InspectStrategyParametersRequest),
  });
}

export function submitStrategyScan(
  strategyId: StrategyScanRequestParams['strategyId'],
  config: BacktestConfig,
  spec: StrategyScanSpec,
): Promise<{ reportId: string; jobId: string }> {
  return request(`/api/app/strategies/${encodeURIComponent(strategyId)}/scans`, {
    method: 'POST',
    body: JSON.stringify({ config, spec } satisfies SubmitStrategyScanRequest),
  });
}

export function listStrategyScanReports(
  strategyId: StrategyScanRequestParams['strategyId'],
): Promise<StrategyScanReportSummary[]> {
  return request(`/api/app/strategies/${encodeURIComponent(strategyId)}/scan-reports`);
}

export function findActiveStrategyScanJob(
  strategyId: StrategyScanRequestParams['strategyId'],
): Promise<{ jobId: string; reportId: string } | null> {
  return request(`/api/app/strategies/${encodeURIComponent(strategyId)}/scan-jobs/active`);
}

export function getStrategyScanReport(reportId: string): Promise<StrategyScanReport> {
  return request(`/api/app/strategies/scan-reports/${encodeURIComponent(reportId)}`);
}

export function pollStrategyScan(jobId: string, since = 0): Promise<BacktestJob> {
  const query = serializeQuery({ since: String(since) } satisfies StrategyScanJobRequestQuery);
  return request(`/api/app/strategies/scan-jobs/${encodeURIComponent(jobId)}?${query}`);
}

// —— Daily signals ——

export function deployBacktestReport(reportId: string): Promise<StrategyDeployment> {
  return request('/api/app/signals/deployments', {
    method: 'POST',
    body: JSON.stringify({ reportId } satisfies CreateDeploymentRequest),
  });
}

export function pauseStrategyDeployment(deploymentId: string): Promise<StrategyDeployment> {
  return request(`/api/app/signals/deployments/${deploymentId}/pause`, { method: 'POST' });
}

export function listStrategyDeployments(strategyId: string): Promise<StrategyDeployment[]> {
  const query = serializeQuery({ strategyId } satisfies DeploymentListRequestQuery);
  return request(`/api/app/signals/deployments?${query}`);
}

export function listDeploymentLatestRuns(): Promise<SignalTodayEntry[]> {
  return request('/api/app/signals/deployments/latest-runs');
}

export function listSignalRuns(deploymentId: string, limit = 30): Promise<SignalRun[]> {
  const query = serializeQuery({ limit: String(limit) } satisfies SignalRunListRequestQuery);
  return request(`/api/app/signals/deployments/${encodeURIComponent(deploymentId)}/runs?${query}`);
}

export function getSignalRun(runId: string): Promise<SignalRun> {
  return request(`/api/app/signals/runs/${runId}`);
}

export function submitSignalRun(
  deploymentId: string,
  tradeDate?: string,
): Promise<{ runId: string; jobId: string | null; started: boolean }> {
  return request(`/api/app/signals/deployments/${encodeURIComponent(deploymentId)}/runs`, {
    method: 'POST',
    body: JSON.stringify((tradeDate ? { tradeDate } : {}) satisfies SubmitSignalRunRequest),
  });
}

export function pollSignalJob(jobId: string, since = 0): Promise<BacktestJob> {
  const query = serializeQuery({ since: String(since) } satisfies SignalRunJobRequestQuery);
  return request(`/api/app/signals/run-jobs/${jobId}?${query}`);
}

export function getStrategyExecutionOverview(
  deploymentId: string,
): Promise<StrategyExecutionOverview> {
  return request(`/api/app/signals/deployments/${deploymentId}/execution-overview`);
}

export function updateSignalExecution(
  executionId: string,
  input: ActualExecutionUpdate,
): Promise<SignalRun> {
  return request(`/api/app/signals/executions/${executionId}`, {
    method: 'PATCH',
    body: JSON.stringify(input satisfies ActualExecutionRequest),
  });
}

import type {
  IndexValuationCatalog,
  IndexValuationSeries,
  MarketStateScope,
  MarketStateSnapshot,
  MarketWeatherDimension,
  MarketWeatherFrequency,
  MarketWeatherSeries,
  ResearchUniverseRunResultV1,
  UniverseSpecV1,
  StockSeries,
  SavedMeta,
  SavedStrategy,
  StrategyCard,
} from '@jixie/shared';

// Agent: START one turn (the model iterates on the current code; history lives on the strategy row).
// Returns a turnId immediately — subscribe via subscribeAgentTurn to stream the reply.
export function sendAgent(
  strategyId: StrategyAgentRequestParams['strategyId'],
  message: string,
  code: string,
  language: 'typescript' | 'python' = 'typescript',
  analysis?: Pick<StrategyAgentRequest, 'reportId' | 'dataReferences'>,
): Promise<{ turnId: string }> {
  return request(`/api/app/strategies/${encodeURIComponent(strategyId)}/agent/turns`, {
    method: 'POST',
    body: JSON.stringify({ message, code, language, ...analysis } satisfies StrategyAgentRequest),
  });
}

// —— Saved strategies (product line 1 persistence) —— created on the first Agent prompt, then updated by id:
// messages in real time, config/name on a run.

export function listStrategies(): Promise<StrategyCard[]> {
  return request('/api/app/strategies');
}

export function getStrategy(id: string): Promise<SavedStrategy> {
  return request(`/api/app/strategies/${id}`);
}

// Create a NEW strategy row. The server names it from `prompt`, or from code when prompt is absent.
export function createStrategy(config: BacktestConfig, prompt?: string): Promise<SavedMeta> {
  const { name: _clientName, ...runnableConfig } = config;
  const body = { ...runnableConfig, ...(prompt ? { prompt } : {}) };
  return request('/api/app/strategies', {
    method: 'POST',
    body: JSON.stringify(body satisfies CreateStrategyRequest),
  });
}

// Update an existing strategy by id. `{ messages }` alone = real-time chat save (config untouched);
// `{ config }` = a run's config/name update (drops the stale lastResult when code/range/capital moved).
export function updateStrategy(id: string, patch: UpdateStrategyRequest): Promise<SavedMeta> {
  return request(`/api/app/strategies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch satisfies UpdateStrategyRequest),
  });
}

export function deleteStrategy(id: string): Promise<{ ok: true }> {
  return request(`/api/app/strategies/${id}`, { method: 'DELETE' });
}

export function fetchSharingCatalog(signal?: AbortSignal): Promise<SharingCatalog> {
  return request('/api/app/library', { signal });
}

export function setStrategyVisibility(
  id: string,
  visibility: AssetVisibility,
): Promise<{ id: string; visibility: AssetVisibility }> {
  return request(`/api/app/strategies/${encodeURIComponent(id)}/visibility`, {
    method: 'PATCH',
    body: JSON.stringify({ visibility } satisfies StrategyVisibilityRequest),
  });
}

export function copyPublicStrategy(id: string): Promise<{ id: string; name: string }> {
  return request(`/api/app/library/strategies/${encodeURIComponent(id)}/copy`, {
    method: 'POST',
  });
}

export function runResearchUniverse(spec: UniverseSpecV1): Promise<ResearchUniverseRunResultV1> {
  return request('/api/app/research/universe-queries', {
    method: 'POST',
    body: JSON.stringify(spec satisfies ResearchUniverseRequest),
  });
}

// A verified object's chartable daily series.
export function fetchInstrumentSeries(
  assetType: InstrumentAssetTypeRequestParam,
  id: string,
  start?: string,
  end?: string,
): Promise<StockSeries> {
  const query = serializeQuery({
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
  } satisfies InstrumentSeriesRequestQuery);
  const suffix = query ? `?${query}` : '';

  return request(
    `/api/app/market/instruments/${assetType}/${encodeURIComponent(id)}/series${suffix}`,
  );
}

// tsCode → name (bulk) — e.g. instrument labels in execution detail.
export function fetchInstrumentNames(codes: string[]): Promise<Record<string, string>> {
  const query = serializeQuery({ codes: codes.join(',') } satisfies InstrumentNamesRequestQuery);
  return request(`/api/app/market/instruments/names?${query}`);
}

// Index daily close (e.g. 000300.SH) over a range — benchmark curves in backtest results.
export function fetchIndexSeries(
  code: string,
  start: string,
  end: string,
): Promise<{ points: { date: string; close: number }[] }> {
  const query = serializeQuery({ start, end } satisfies InstrumentSeriesRequestQuery);
  return request(`/api/app/market/indices/${code}/series?${query}`);
}

export function fetchIndexValuationCatalog(signal?: AbortSignal): Promise<IndexValuationCatalog> {
  return request('/api/app/market/index-valuations', { signal });
}

export function fetchIndexValuationSeries(
  code: string,
  signal?: AbortSignal,
): Promise<IndexValuationSeries> {
  return request(`/api/app/market/index-valuations/${encodeURIComponent(code)}`, { signal });
}

export function fetchMarketState(
  scope: MarketStateScope,
  signal?: AbortSignal,
): Promise<MarketStateSnapshot> {
  const query = serializeQuery({ scope } satisfies MarketStateRequestQuery);
  return request(`/api/app/market/state?${query}`, { signal });
}

export function fetchMarketWeather(
  dimension: MarketWeatherDimension,
  frequency: MarketWeatherFrequency,
  signal?: AbortSignal,
): Promise<MarketWeatherSeries> {
  const query = serializeQuery({ dimension, frequency } satisfies MarketWeatherRequestQuery);
  return request(`/api/app/market/weather?${query}`, { signal });
}

import type {
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
} from '@jixie/shared';

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
import type { FactorQuestionTurnV1, FactorQuestionHistoryV1 } from '@jixie/shared';

// Embedded analyses retain exact Python runs independently from model prose.
import type {
  ResearchEmbeddedAnalysisV1,
  ResearchEmbeddedVersionV1,
  ResearchEmbeddedRunV1,
  ResearchEmbeddedRunSummaryV1,
  ResearchEmbeddedHostV1,
  ResearchEmbeddedPageV1,
} from '@jixie/shared';
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
export function changeEmbeddedInputMode(
  documentId: string,
  inputMode: 'retained' | 'current',
  expectedRevision: number,
): Promise<ResearchDocumentV1> {
  return request(`${embeddedApi}/documents/${encodeURIComponent(documentId)}/input-mode`, {
    method: 'PATCH',
    body: JSON.stringify({
      inputMode,
      expectedRevision,
    } satisfies ResearchEmbeddedInputModeRequest),
  });
}
export function readEmbeddedInput(
  analysisId: string,
  runId: string,
  inputId: string,
): Promise<{ response: unknown; sha256: string | null; byteSize: number }> {
  return request(
    `${embeddedApi}/${encodeURIComponent(analysisId)}/runs/${encodeURIComponent(runId)}/inputs/${encodeURIComponent(inputId)}`,
  );
}
export function readEmbeddedAnalysis(
  analysisId: string,
  signal?: AbortSignal,
): Promise<ResearchEmbeddedAnalysisV1> {
  return request(`${embeddedApi}/${encodeURIComponent(analysisId)}`, { signal });
}
