import type { z } from 'zod';
import type { embeddedDraftSchema } from './api/research.js';
import type { ResearchCellOutputBlockV1 } from './research.js';

/**
 * 约束嵌入式分析的输入、输出及运行大小。
 *
 * Define bounded input, output and runtime sizes for embedded analysis.
 */
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

export type ResearchEmbeddedDraftInputV1 = z.input<typeof embeddedDraftSchema>;

/**
 * 为当前 Agent 请求读取分析宿主身份和上下文，不作为执行存档。
 *
 * Read host identity and context for the current Agent request, without an execution archive.
 */
export interface ResearchEmbeddedContextV1 {
  host: ResearchEmbeddedHostV1;
  name: string;
  code: string;
  codeHash: string;
  language: string;
  capturedAt: string;
  report?: { type: 'factor' | 'backtest'; id: string; contentHash: string };
}

/**
 * 保存可编辑分析版本源码、修订和复制关系。
 *
 * Describe editable analysis source, revisions and copy lineage.
 */
export interface ResearchEmbeddedVersionV1 {
  id: string;
  analysisId: string;
  number: number;
  parentVersionId: string | null;
  source: string;
  parameters: ResearchEmbeddedParametersV1;
  inputScope: string;
  reportId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 聚合嵌入式版本及宿主归属，供对话重用。
 *
 * Describe an embedded analysis, versions and host ownership.
 */
export interface ResearchEmbeddedAnalysisV1 {
  version: 1;
  id: string;
  host: ResearchEmbeddedHostV1;
  title: string;
  activeRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 稳定引用一次持久运行，供消息卡片和继续研究。
 *
 * Identify a durable run for message cards and research continuation.
 */
export interface ResearchEmbeddedRunReferenceV1 {
  analysisId: string;
  versionId: string;
  runId: string;
}

/**
 * 表示目录选择形成的数据请求，不是已经加载的数据或注入的 Python 变量。
 *
 * A catalog selection is a request, not data or a Python variable injected into the runtime.
 */
export interface ResearchDataReferenceV1 {
  label: string;
  method: string;
  arguments: Record<string, unknown>;
}

/**
 * 提供嵌入式运行身份、状态和时间，供历史列表。
 *
 * Describe embedded run identity, state and timing for history.
 */
export interface ResearchEmbeddedRunSummaryV1 extends ResearchEmbeddedRunReferenceV1 {
  sequence: number;
  revision: number;
  jobId: string;
  status: ResearchEmbeddedRunStatusV1;
  errorCode: ResearchEmbeddedErrorCodeV1 | null;
  /** Technical diagnostics; UI explains errorCode in the user's language. */
  error: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * 返回当前草稿代码、参数、最近运行输出及错误；修订不同表示输出过期。
 *
 * Return current draft code and parameters with latest outputs and errors; differing revisions indicate stale output.
 */
export interface ResearchEmbeddedRunV1 extends ResearchEmbeddedRunSummaryV1 {
  researchDocumentId?: string;
  currentRevision: number;
  source: string;
  parameters: ResearchEmbeddedParametersV1;
  inputScope: string;
  outputs: ResearchCellOutputBlockV1[];
  limits: ResearchEmbeddedLimitsV1;
}

/**
 * 组合分页嵌入式记录与继续游标。
 *
 * Collect paginated embedded records and continuation metadata.
 */
export interface ResearchEmbeddedPageV1<T> {
  items: T[];
  nextCursor: string | null;
}
