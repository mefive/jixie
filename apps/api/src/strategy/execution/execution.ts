import { FactorHost } from '#engine/adapters/factor-host.js';
import type { EngineDataPort } from '#engine/data/data-port.js';
import { StrategyFactor } from '../factors/factor.js';
import { runStrategy, runStrategyWithSignals } from '#engine/simulation/run.js';
import type {
  BacktestResult,
  CostModel,
  EngineContext,
  SignalBacktestOutput,
} from '#engine/types.js';
import type { UserLogSink } from '#infra/runtime/console.js';
import type { FactorDependency, Locale, StrategyLanguage, StrategyParamValue } from '@jixie/shared';
import { StrategyRuntime } from '../runtime/strategy-runtime.js';
import type { StrategyRuntimeInstance } from '../runtime/contract.js';

export interface StrategyExecutionInput {
  code: string;
  language?: StrategyLanguage;
  locale?: Locale;
  factors?: StrategyFactor[];
  paramOverrides?: Record<string, StrategyParamValue>;
  dataPort: EngineDataPort;
  onLog?: (line: string) => void;
  onUserLog?: UserLogSink;
}

export interface StrategyRunOptions {
  start: string;
  end: string;
  initialCash: number;
  cost?: Partial<CostModel>;
  captureSignals?: boolean;
}

/** Owns the strategy and factor resources for exactly one engine run. */
export class StrategyExecution {
  private started = false;
  private closed = false;

  private constructor(
    private readonly runtime: StrategyRuntimeInstance,
    private readonly factors: FactorHost,
    private readonly resolved: StrategyFactor[],
    private readonly input: StrategyExecutionInput,
  ) {}

  static async create(input: StrategyExecutionInput): Promise<StrategyExecution> {
    const runtime = await StrategyRuntime.start({
      language: input.language ?? 'typescript',
      code: input.code,
      onUserLog: input.onUserLog,
      paramOverrides: input.paramOverrides,
      locale: input.locale,
    });
    let factors: FactorHost | undefined;
    try {
      factors = new FactorHost(
        (input.factors ?? []).map((factor) => factor.toEngineModule()),
        input.onUserLog,
      );
      const resolved = StrategyFactor.resolveAll(input.factors ?? [], await factors.describe());
      return new StrategyExecution(runtime, factors, resolved, { ...input });
    } catch (error) {
      try {
        factors?.close();
      } finally {
        runtime.close();
      }
      throw error;
    }
  }

  /** Return a detached lineage snapshot for reports and caller-owned admission checks. */
  get factorDependencies(): FactorDependency[] {
    return this.resolved.map((factor) => factor.toDependency());
  }

  run(options: StrategyRunOptions & { captureSignals: true }): Promise<SignalBacktestOutput>;
  run(options: StrategyRunOptions & { captureSignals?: false }): Promise<BacktestResult>;
  run(options: StrategyRunOptions): Promise<BacktestResult | SignalBacktestOutput>;
  async run(options: StrategyRunOptions): Promise<BacktestResult | SignalBacktestOutput> {
    if (this.closed || this.started) {
      throw new Error('Strategy execution requires a fresh, open instance');
    }
    this.started = true;

    const engineConfig = {
      start: options.start,
      end: options.end,
      initialCash: options.initialCash,
      cost: options.cost,
      locale: this.input.locale,
      strategy: {
        ...this.runtime.metadata,
        onBar: (context: EngineContext) => this.runtime.execute({ context }),
      },
      dataPort: this.input.dataPort,
      factorExecution: this.factors,
      customFactors: this.resolved.map((factor) => factor.toEngineModule()),
      onLog: this.input.onLog,
    };
    const output = options.captureSignals
      ? await runStrategyWithSignals(engineConfig)
      : await runStrategy(engineConfig);
    if (this.input.factors) {
      const result = 'capture' in output ? output.result : output;
      result.factorDependencies = this.factorDependencies;
    }
    return output;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.factors.close();
    } finally {
      this.runtime.close();
    }
  }
}
