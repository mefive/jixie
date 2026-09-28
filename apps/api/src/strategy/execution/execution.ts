import { FactorHost } from './factor-host.js';
import type { EngineDataPort } from '#engine/data/data-port.js';
import { StrategyFactor } from '../factors/factor.js';
import { runStrategy } from '#engine/simulation/run.js';
import type { CostModel, EngineContext, StrategyExecutionResult } from '#engine/types.js';
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
  retainFinalState?: boolean;
}

/** Owns the strategy and factor resources for exactly one engine run. */
export class StrategyExecution {
  private started = false;
  private closed = false;

  private constructor(
    private readonly runtime: StrategyRuntimeInstance,
    private readonly factorHost: FactorHost,
    private readonly dependencies: FactorDependency[],
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
    let factorHost: FactorHost | undefined;
    try {
      factorHost = new FactorHost(input.factors ?? [], input.onUserLog);
      const factorDefinitions = await factorHost.describe();
      StrategyFactor.validateRuntimeMetadata(input.factors ?? [], factorDefinitions);
      const byId = new Map(factorDefinitions.map((definition) => [definition.id, definition]));
      const dependencies = (input.factors ?? []).map((factor) =>
        factor.toDependency(byId.get(factor.key)!),
      );
      return new StrategyExecution(runtime, factorHost, dependencies, { ...input });
    } catch (error) {
      try {
        factorHost?.close();
      } finally {
        runtime.close();
      }
      throw error;
    }
  }

  /** Return a detached lineage snapshot for reports and caller-owned admission checks. */
  get factorDependencies(): FactorDependency[] {
    return structuredClone(this.dependencies);
  }

  async run(options: StrategyRunOptions): Promise<StrategyExecutionResult> {
    if (this.closed || this.started) {
      throw new Error('Strategy execution requires a fresh, open instance');
    }
    this.started = true;

    const engineConfig = {
      retainFinalState: options.retainFinalState,
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
      factorExecution: this.factorHost,
      onLog: this.input.onLog,
    };
    const output = await runStrategy(engineConfig);
    if (this.input.factors) {
      output.result.factorDependencies = this.factorDependencies;
    }
    return output;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.factorHost.close();
    } finally {
      this.runtime.close();
    }
  }
}
