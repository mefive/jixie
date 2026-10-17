import type { Locale, StrategyLanguage, StrategyParamValue } from '@jixie/shared';
import type { EngineContext, EngineStrategy } from '#backtesting/contract.js';
import type { UserLogSink } from '#infra/sandbox/console.js';
import type { Sandbox } from '#infra/sandbox/sandbox.js';

/**
 * 配置策略沙盒启动的源码、语言与宿主能力。
 *
 * Configure strategy sandbox startup with source, language and host capabilities.
 */
export interface StrategyStartOptions {
  language: StrategyLanguage;
  code: string;
  paramOverrides?: Record<string, StrategyParamValue>;
  locale?: Locale;
  onUserLog?: UserLogSink;
}

/**
 * 承载一次决策调用的引擎上下文，不代表完整模拟配置。
 *
 * Supply the engine context for one strategy decision rather than a full simulation.
 */
export interface StrategyDecisionInput {
  context: EngineContext;
}

export type StrategySandboxMetadata = Omit<EngineStrategy, 'onBar'>;

export type StrategySandboxInstance = Pick<
  Sandbox<StrategyDecisionInput, void, StrategySandboxMetadata>,
  'metadata' | 'execute' | 'close'
>;
