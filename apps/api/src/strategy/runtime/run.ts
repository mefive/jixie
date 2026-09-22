import { FactorHost } from '#engine/adapters/factor-host.js';
import type { EngineDataPort } from '#engine/data/data-port.js';
import type { CustomFactorModule } from '#engine/factors/custom-factor.js';
import { runStrategy, runStrategyWithSignals } from '#engine/simulation/run.js';
import type { BacktestResult, CostModel, SignalBacktestOutput } from '#engine/types.js';
import type { UserLogSink } from '#infra/runtime/console.js';
import type { Locale, StrategyLanguage, StrategyParamValue } from '@jixie/shared';
import { StrategyRuntime } from './strategy-runtime.js';
import type { EngineContext } from '#engine/types.js';

export interface SandboxedBacktestConfig {
  code: string;
  language?: StrategyLanguage;
  start: string;
  end: string;
  initialCash: number;
  cost?: Partial<CostModel>;
  locale?: Locale;
  customFactors?: CustomFactorModule[];
  paramOverrides?: Record<string, StrategyParamValue>;
}

export async function runSandboxedBacktest(
  config: SandboxedBacktestConfig,
  port: EngineDataPort,
  onLog?: (line: string) => void,
  onUserLog?: UserLogSink,
): Promise<BacktestResult> {
  return runSandboxed(config, port, false, onLog, onUserLog) as Promise<BacktestResult>;
}

export async function runSandboxedSignalCapture(
  config: SandboxedBacktestConfig,
  port: EngineDataPort,
  onLog?: (line: string) => void,
  onUserLog?: UserLogSink,
): Promise<SignalBacktestOutput> {
  return runSandboxed(config, port, true, onLog, onUserLog) as Promise<SignalBacktestOutput>;
}

async function runSandboxed(
  config: SandboxedBacktestConfig,
  port: EngineDataPort,
  captureSignals: boolean,
  onLog?: (line: string) => void,
  onUserLog?: UserLogSink,
): Promise<BacktestResult | SignalBacktestOutput> {
  const runtime = await StrategyRuntime.start({
    language: config.language ?? 'typescript',
    code: config.code,
    onUserLog,
    paramOverrides: config.paramOverrides,
    locale: config.locale,
  });
  let factors: FactorHost | undefined;
  try {
    factors = new FactorHost(config.customFactors ?? [], onUserLog);
    const engineConfig = {
      start: config.start,
      end: config.end,
      initialCash: config.initialCash,
      cost: config.cost,
      locale: config.locale,
      strategy: {
        ...runtime.metadata,
        onBar: (context: EngineContext) => runtime.execute({ context }),
      },
      dataPort: port,
      factorExecution: factors,
      customFactors: config.customFactors,
      onLog,
    };
    return captureSignals
      ? await runStrategyWithSignals(engineConfig)
      : await runStrategy(engineConfig);
  } finally {
    try {
      factors?.close();
    } finally {
      runtime.close();
    }
  }
}
