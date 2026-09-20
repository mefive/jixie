import { prismaDataPort } from '#engine/adapters/prisma-port.js';
import type { BacktestResult } from '#engine/types.js';
import { t } from '#i18n/messages.js';
import type { UserLogSink } from '#infra/runtime/console.js';
import type { BacktestConfig, Locale, StrategyParamValue } from '@jixie/shared';
import { prepareStrategyFactors } from '../factor-inputs/prepare.js';
import { attachBacktestRiskAnalysis } from '../risk/backtest-risk-analysis.js';
import { runSandboxedBacktest } from '../runtime/run.js';

/** Dispatch a DB-authored strategy to its language runtime while keeping one TypeScript engine. */
export async function runConfiguredBacktest(
  config: BacktestConfig,
  userId: string,
  locale: Locale,
  onSystemLog?: (line: string) => void,
  onUserLog?: UserLogSink,
  paramOverrides?: Record<string, StrategyParamValue>,
): Promise<BacktestResult> {
  const language = config.language ?? 'typescript';
  const runtimeVersion = config.runtimeVersion ?? 'ts-v1';
  if (
    (language === 'typescript' && runtimeVersion !== 'ts-v1') ||
    (language === 'python' && runtimeVersion !== 'py-v1')
  ) {
    throw new Error(`runtimeVersion ${runtimeVersion} does not match language ${language}`);
  }

  const prepared = await prepareStrategyFactors(config.code, userId);
  const result = await runSandboxedBacktest(
    { ...config, customFactors: prepared.modules, locale, paramOverrides },
    prismaDataPort,
    onSystemLog,
    onUserLog,
  );
  result.factorDependencies = prepared.factors;
  await attachRiskAnalysis(result, locale, onSystemLog);
  return result;
}

async function attachRiskAnalysis(
  result: BacktestResult,
  locale: Locale,
  onSystemLog: ((line: string) => void) | undefined,
): Promise<void> {
  try {
    await attachBacktestRiskAnalysis(result);
  } catch (error) {
    onSystemLog?.(
      t(locale, 'backtestRiskAnalysisUnavailable', {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
