import type { BacktestConfig, Locale, StrategyParamValue } from '@jixie/shared';
import type { UserLogSink } from '../lib/sandbox-console.js';
import { createPythonStrategyRuntime } from '../strategy/python/runtime.js';
import { prepareCustomFactors } from './prepare-custom-factors.js';
import { prismaDataPort } from './prisma-port.js';
import { runStrategy } from './run.js';
import type { BacktestResult } from './types.js';
import { runWalledBacktest } from './walled-run.js';

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
    const customFactors = await prepareCustomFactors(config.code, userId, locale);
    return runWalledBacktest(
      { ...config, customFactors, locale, paramOverrides },
      prismaDataPort,
      onSystemLog,
      onUserLog,
    );
  }

  const runtime = await createPythonStrategyRuntime(config.code, onUserLog, paramOverrides, locale);
  try {
    return await runStrategy({
      start: config.start,
      end: config.end,
      initialCash: config.initialCash,
      cost: config.cost,
      locale,
      strategy: runtime.strategy,
      dataPort: prismaDataPort,
      onLog: onSystemLog,
    });
  } finally {
    await runtime.close();
  }
}
