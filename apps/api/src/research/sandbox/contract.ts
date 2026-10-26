import type { ResearchCellOutputBlockV1, ResearchEmbeddedParametersV1 } from '@jixie/shared';
import type { SandboxBridge } from '#infra/sandbox/sandbox-bridge.js';
import type { ResearchPythonAnalysis } from './host/analysis-types.js';

/**
 * 提供 Python Cell 身份与源码，供静态分析。
 *
 * Supply Python cell identity and source for analysis.
 */
export interface ResearchCellInput {
  id: string;
  source: string;
}

/**
 * 提供一次 Cell 执行的源码、上下文和输入模式。
 *
 * Supply source, context and input mode for one cell run.
 */
export interface ResearchCellRunInput {
  cell: ResearchCellInput;
  parameters?: ResearchEmbeddedParametersV1;
}

/**
 * 配置单 Cell 日志、取消和宿主请求观察。
 *
 * Configure per-cell logging, cancellation and host-request observation.
 */
export interface ResearchCellRunOptions {
  signal?: AbortSignal;
  limits?: { sdkRequests: number; inputBytes: number };
}

/**
 * 封装单 Cell 终态、输出与诊断，不代表持久 ResearchExecution。
 *
 * Describe one cell's terminal output and diagnostics independently of persisted executions.
 */
export interface ResearchCellRunResult {
  outputs: ResearchCellOutputBlockV1[];
  definitions: string[];
  references: string[];
}

/**
 * 返回研究会话运行版本与能力，供握手校验。
 *
 * Describe research session version and capabilities for handshake validation.
 */
export interface ResearchSandboxMetadata {
  environment: Record<string, unknown>;
  capabilities: string[];
}

/**
 * 在公共 Bridge 上增加研究分析与重置能力。
 *
 * Extend the shared bridge with research analysis and reset capabilities.
 */
export interface ResearchBridgeContract extends SandboxBridge<
  ResearchCellRunInput,
  ResearchCellRunResult,
  ResearchSandboxMetadata,
  ResearchCellRunOptions
> {
  analyze(cells: ResearchCellInput[]): Promise<ResearchPythonAnalysis[]>;
  reset(): Promise<void>;
}

/**
 * 提供 Research 会话启动所需宿主配置。
 *
 * Configure host startup for a Research session.
 */
export interface ResearchStartOptions {
  documentId: string;
  signal?: AbortSignal;
}
