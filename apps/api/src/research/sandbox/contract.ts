import type { ResearchCellOutputBlockV1, ResearchEmbeddedParametersV1 } from '@jixie/shared';
import type { SandboxBridge } from '#infra/sandbox/sandbox-bridge.js';
import type { ResearchPythonAnalysis } from './host/analysis-types.js';
import type { ResearchRequestObserver } from './host/dispatch.js';

export interface ResearchCellInput {
  id: string;
  source: string;
}
export interface ResearchCellRunInput {
  cell: ResearchCellInput;
  parameters?: ResearchEmbeddedParametersV1;
}
export interface ResearchCellRunOptions {
  signal?: AbortSignal;
  observer?: ResearchRequestObserver;
  captureEnvironment?(environment: Record<string, unknown>): Promise<void>;
}
export interface ResearchCellRunResult {
  outputs: ResearchCellOutputBlockV1[];
  definitions: string[];
  references: string[];
  environmentFingerprint: string;
}
export interface ResearchSandboxMetadata {
  environment: Record<string, unknown>;
  capabilities: string[];
}

export interface ResearchBridgeContract extends SandboxBridge<
  ResearchCellRunInput,
  ResearchCellRunResult,
  ResearchSandboxMetadata,
  ResearchCellRunOptions
> {
  analyze(cells: ResearchCellInput[]): Promise<ResearchPythonAnalysis[]>;
  reset(): Promise<void>;
}

export interface ResearchStartOptions {
  documentId: string;
  signal?: AbortSignal;
}
