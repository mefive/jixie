import type { Locale, StrategyLanguage, StrategyParamValue } from '@jixie/shared';
import type { EngineContext, EngineStrategy } from '#backtesting/contract.js';
import type { UserLogSink } from '#infra/runtime/console.js';
import type { SandboxRuntime, SandboxResource } from '#infra/runtime/sandbox-runtime.js';
import type { SandboxBridge } from '#infra/runtime/sandbox-bridge.js';
import type { StrategyBridgeOptions, StrategyTransport } from './bridge.js';

export interface StrategyStartOptions {
  language: StrategyLanguage;
  code: string;
  paramOverrides?: Record<string, StrategyParamValue>;
  locale?: Locale;
  onUserLog?: UserLogSink;
}

export interface StrategyExecutionInput {
  context: EngineContext;
}

export type StrategyRuntimeMetadata = Omit<EngineStrategy, 'onBar'>;
export type StrategyBridgeContract = SandboxBridge<
  StrategyExecutionInput,
  void,
  StrategyRuntimeMetadata
>;

export type StrategyRuntimeInstance = Pick<
  SandboxRuntime<StrategyExecutionInput, void, StrategyRuntimeMetadata>,
  'metadata' | 'execute' | 'close'
>;

/** Language-specific startup inputs; the shared runtime owns acquisition and initialization. */
export interface StrategyRuntimePreparation {
  createResource(): Promise<StrategyTransport & SandboxResource>;
  bridgeOptions: StrategyBridgeOptions;
}
