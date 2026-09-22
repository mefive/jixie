import type { ResearchCellOutputBlockV1, ResearchEmbeddedParametersV1 } from '@jixie/shared';
import type { ResearchRequestObserver } from './host/dispatch.js';

export interface ResearchCellInput {
  id: string;
  source: string;
}
export interface ResearchExecutionInput {
  cell: ResearchCellInput;
  parameters?: ResearchEmbeddedParametersV1;
}
export interface ResearchExecutionOptions {
  signal?: AbortSignal;
  observer?: ResearchRequestObserver;
  captureEnvironment?(environment: Record<string, unknown>): Promise<void>;
}
export interface ResearchExecution {
  outputs: ResearchCellOutputBlockV1[];
  definitions: string[];
  references: string[];
  environmentFingerprint: string;
}
export interface ResearchRuntimeMetadata {
  environment: Record<string, unknown>;
  capabilities: string[];
}
export interface ResearchStartOptions {
  documentId: string;
  signal?: AbortSignal;
}
