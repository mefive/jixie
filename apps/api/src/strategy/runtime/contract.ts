import type { Locale, StrategyLanguage, StrategyParamValue } from '@jixie/shared';
import type { EngineContext, EngineStrategy } from '#backtesting/contract.js';
import type { UserLogSink } from '#infra/runtime/console.js';
import type { Sandbox } from '#infra/runtime/sandbox.js';

export interface StrategyStartOptions {
  language: StrategyLanguage;
  code: string;
  paramOverrides?: Record<string, StrategyParamValue>;
  locale?: Locale;
  onUserLog?: UserLogSink;
}

export interface StrategyCallbackInput {
  context: EngineContext;
}

export type StrategySandboxMetadata = Omit<EngineStrategy, 'onBar'>;

export type StrategySandboxInstance = Pick<
  Sandbox<StrategyCallbackInput, void, StrategySandboxMetadata>,
  'metadata' | 'execute' | 'close'
>;
