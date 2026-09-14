import type { ResearchCellOutputBlockV1 } from './research.js';

export interface ResearchEmbeddedLimitsV1 {
  sourceCharacters: number;
  parametersBytes: number;
  sdkRequests: number;
  inputBytes: number;
  executionMilliseconds: number;
}

export const RESEARCH_EMBEDDED_LIMITS = {
  sourceCharacters: 20_000,
  parametersBytes: 16_384,
  sdkRequests: 16,
  inputBytes: 32 * 1024 * 1024,
  executionMilliseconds: 30_000,
} as const satisfies ResearchEmbeddedLimitsV1;

export type ResearchEmbeddedHostV1 = { type: 'factor' | 'strategy'; id: string };
export type ResearchEmbeddedParametersV1 = Record<string, string | number | boolean | null>;
export type ResearchEmbeddedRunStatusV1 = 'queued' | 'running' | 'success' | 'error' | 'cancelled';
export type ResearchEmbeddedErrorCodeV1 =
  | 'not_found'
  | 'frozen'
  | 'revision_conflict'
  | 'run_in_progress'
  | 'request_conflict'
  | 'invalid_report'
  | 'input_limit'
  | 'request_limit'
  | 'timeout'
  | 'cancelled'
  | 'interrupted'
  | 'execution_failed';

export interface ResearchEmbeddedDraftInputV1 {
  source: string;
  /** Explicit initial `parameters` dictionary, independently snapshotted for each run. */
  parameters: ResearchEmbeddedParametersV1;
  inputScope: string;
  reportId?: string;
}

export interface ResearchEmbeddedContextV1 {
  host: ResearchEmbeddedHostV1;
  name: string;
  code: string;
  codeHash: string;
  language: string;
  capturedAt: string;
  report?: { type: 'factor' | 'backtest'; id: string; contentHash: string };
}

export interface ResearchEmbeddedVersionV1 {
  id: string;
  analysisId: string;
  number: number;
  parentVersionId: string | null;
  source: string;
  parameters: ResearchEmbeddedParametersV1;
  inputScope: string;
  context: ResearchEmbeddedContextV1;
  revision: number;
  frozenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchEmbeddedAnalysisV1 {
  version: 1;
  id: string;
  host: ResearchEmbeddedHostV1;
  title: string;
  activeRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchEmbeddedRunReferenceV1 {
  analysisId: string;
  versionId: string;
  runId: string;
}

export interface ResearchEmbeddedRunSummaryV1 extends ResearchEmbeddedRunReferenceV1 {
  sequence: number;
  revision: number;
  jobId: string;
  status: ResearchEmbeddedRunStatusV1;
  sourceHash: string;
  errorCode: ResearchEmbeddedErrorCodeV1 | null;
  /** Technical diagnostics; UI explains errorCode in the user's language. */
  error: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ResearchEmbeddedRunV1 extends ResearchEmbeddedRunSummaryV1 {
  source: string;
  executedSource: string;
  parameters: ResearchEmbeddedParametersV1;
  inputScope: string;
  context: ResearchEmbeddedContextV1;
  environment: Record<string, unknown> | null;
  environmentFingerprint: string | null;
  outputs: ResearchCellOutputBlockV1[];
  inputs: ResearchEmbeddedInputV1[];
  limits: ResearchEmbeddedLimitsV1;
}

export interface ResearchEmbeddedInputV1 {
  id: string;
  sequence: number;
  method: string;
  arguments: Record<string, unknown>;
  status: 'loading' | 'received' | 'error' | 'interrupted';
  sha256: string | null;
  byteSize: number;
  rowCount: number | null;
  metadata: Record<string, unknown>;
  error: string | null;
  requestedAt: string;
  capturedAt: string | null;
}

export interface ResearchEmbeddedPageV1<T> {
  items: T[];
  nextCursor: string | null;
}
