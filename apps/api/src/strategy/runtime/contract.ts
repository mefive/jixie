import type { Locale, StrategyLanguage, StrategyParamValue } from '@jixie/shared';
import type { EngineContext, EngineStrategy } from '#engine/types.js';
import type { UserLogSink } from '#infra/runtime/console.js';
import type { SandboxRuntime } from '#infra/runtime/sandbox-runtime.js';

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
export type StrategyRuntimeInstance = Pick<
  SandboxRuntime<StrategyExecutionInput, void, StrategyRuntimeMetadata>,
  'metadata' | 'execute' | 'close'
>;
