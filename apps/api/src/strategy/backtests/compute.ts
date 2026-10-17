import { prismaDataPort } from '#backtesting/adapters/prisma-port.js';
import type { BacktestResult } from './result.js';
import { t } from '#i18n/messages.js';
import type { UserLogSink } from '#infra/sandbox/console.js';
import type { BacktestConfig, Locale, StrategyParamValue } from '@jixie/shared';
import { StrategyFactor } from '../factors/strategy-factor.js';
import { attachBacktestRiskAnalysis } from '../risk/backtest-risk-analysis.js';
import { StrategySimulation } from '../simulation/strategy-simulation.js';

/**
 * 按策略语言选择运行时，所有语言仍复用唯一 TypeScript 撮合引擎。
 *
 * Dispatch a DB-authored strategy to its language runtime while keeping one TypeScript engine.
 */
export async function runBacktest(
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

  const factors = await StrategyFactor.fromStrategySource(config.code, userId);
  const simulation = await StrategySimulation.create({
    code: config.code,
    language,
    factors,
    locale,
    paramOverrides,
    dataPort: prismaDataPort,
    onLog: onSystemLog,
    onUserLog,
  });
  let result: BacktestResult;
  try {
    result = await simulation.run(config);
  } finally {
    simulation.close();
  }
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
