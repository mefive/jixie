import type {
  ResearchUniverseRequest,
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
} from '@jixie/shared/api/research';
import type {
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
  ResearchStrategyDraftResultV1,
  ResearchDataCatalogResultV1,
  ResearchDataCatalogScopeV1,
  ResearchAssetTypeV1,
  ResearchLanguageResultV1,
  ResearchCuratorFindingV1,
  ResearchCuratorRunV1,
  ResearchUniverseRunResultV1,
  UniverseSpecV1,
} from '@jixie/shared';
import { serializeQuery, request } from './client';

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

export function runResearchUniverse(spec: UniverseSpecV1): Promise<ResearchUniverseRunResultV1> {
  return request('/api/app/research/universe-queries', {
    method: 'POST',
    body: JSON.stringify(spec satisfies ResearchUniverseRequest),
  });
}
