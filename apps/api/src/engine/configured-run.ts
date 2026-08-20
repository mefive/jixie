import type { BacktestConfig, Locale, StrategyParamValue } from '@jixie/shared';
import type { UserLogSink } from '../lib/sandbox-console.js';
import { t } from '../i18n/messages.js';
import { attachBacktestRiskAnalysis } from '../risk/backtest-risk-analysis.js';
import { createPythonStrategyRuntime } from '../strategy/python/runtime.js';
import { prepareStrategyFactors } from './prepare-custom-factors.js';
import { prismaDataPort } from './prisma-port.js';
import { runStrategy } from './run.js';
import type { BacktestResult } from './types.js';
import { runWalledBacktest } from './walled-run.js';
import { PythonFactorHost, withPythonFactorHost } from './python-factor-host.js';

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

  if (language === 'typescript') {
    const prepared = await prepareStrategyFactors(config.code, userId, locale);
    const result = await runWalledBacktest(
      { ...config, customFactors: prepared.modules, locale, paramOverrides },
      prismaDataPort,
      onSystemLog,
      onUserLog,
    );
    result.factorDependencies = prepared.factors;
    await attachRiskAnalysis(result, locale, onSystemLog);
    return result;
  }

  const prepared = await prepareStrategyFactors(config.code, userId, locale);
  const runtime = await createPythonStrategyRuntime(config.code, onUserLog, paramOverrides, locale);
  const factorHost = new PythonFactorHost(onUserLog);
  try {
    const result = await runStrategy({
      start: config.start,
      end: config.end,
      initialCash: config.initialCash,
      cost: config.cost,
      locale,
      strategy: runtime.strategy,
      dataPort: withPythonFactorHost(prismaDataPort, factorHost),
      customFactors: prepared.modules,
      onLog: onSystemLog,
    });
    result.factorDependencies = prepared.factors;
    await attachRiskAnalysis(result, locale, onSystemLog);
    return result;
  } finally {
    factorHost.close();
    await runtime.close();
  }
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
