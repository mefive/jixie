import { FactorHost } from './factor-host.js';
import type { EngineDataPort } from '#backtesting/data/data-port.js';
import { StrategyFactor } from '../factors/strategy-factor.js';
import { BacktestingEngine } from '#backtesting/backtesting-engine.js';
import type { CostModel } from '#backtesting/cost.js';
import type { EngineContext } from '#backtesting/contract.js';
import type { BacktestingFinalState } from '#backtesting/result.js';
import type { BacktestResult } from '../backtests/result.js';
import type { UserLogSink } from '#infra/sandbox/console.js';
import type { FactorDependency, Locale, StrategyLanguage, StrategyParamValue } from '@jixie/shared';
import { StrategySandbox } from '../sandbox/strategy-sandbox.js';
import type { StrategySandboxInstance } from '../sandbox/contract.js';

/**
 * 提供完整策略模拟的配置、来源及初始状态，供宿主装配引擎。
 * Supply configuration, source and initial state for a complete strategy simulation.
 */
export interface StrategySimulationInput {
  code: string;
  language?: StrategyLanguage;
  locale?: Locale;
  factors?: StrategyFactor[];
  paramOverrides?: Record<string, StrategyParamValue>;
  dataPort: EngineDataPort;
  onLog?: (line: string) => void;
  onUserLog?: UserLogSink;
}

/**
 * 配置策略模拟的日志、进度和取消等宿主执行选项。
 * Configure simulation logging, progress and cancellation capabilities.
 */
export interface StrategySimulationOptions {
  start: string;
  end: string;
  initialCash: number;
  cost?: Partial<CostModel>;
  strictFutures?: boolean;
}

/** Owns the strategy and factor resources for exactly one engine run. */
export class StrategySimulation {
  private started = false;
  private closed = false;
  private engine: BacktestingEngine | null = null;

  private constructor(
    private readonly sandbox: StrategySandboxInstance,
    private readonly factorHost: FactorHost,
    private readonly dependencies: FactorDependency[],
    private readonly input: StrategySimulationInput,
  ) {}

  /**
   * 创建策略沙盒与因子宿主并注入引擎，失败时回收已取得资源。
   * Create the strategy sandbox and factor host, inject engine capabilities and clean up failed construction.
   */
  static async create(input: StrategySimulationInput): Promise<StrategySimulation> {
    const sandbox = await StrategySandbox.start({
      language: input.language ?? 'typescript',
      code: input.code,
      onUserLog: input.onUserLog,
      paramOverrides: input.paramOverrides,
      locale: input.locale,
    });
    let factorHost: FactorHost | undefined;
    try {
      factorHost = new FactorHost(input.factors ?? [], input.onUserLog);
      const { definitions: factorDefinitions } = await factorHost.describe();
      StrategyFactor.validateSandboxMetadata(input.factors ?? [], factorDefinitions);
      const byId = new Map(factorDefinitions.map((definition) => [definition.id, definition]));
      const dependencies = (input.factors ?? []).map((factor) =>
        factor.toDependency(byId.get(factor.key)!),
      );
      return new StrategySimulation(sandbox, factorHost, dependencies, { ...input });
    } catch (error) {
      try {
        factorHost?.close();
      } finally {
        sandbox.close();
      }
      throw error;
    }
  }

  /**
   * 返回独立血缘快照，供报告留存及调用方准入检查。
   * Return a detached lineage snapshot for reports and caller-owned admission checks.
   */
  get factorDependencies(): FactorDependency[] {
    return structuredClone(this.dependencies);
  }

  /**
   * 运行已装配的引擎模拟，并由会话统一管理外部沙盒生命周期。
   * Run the prepared simulation engine under the session's sandbox lifecycle.
   */
  async run(options: StrategySimulationOptions): Promise<BacktestResult> {
    if (this.closed || this.started) {
      throw new Error('Strategy execution requires a fresh, open instance');
    }
    this.started = true;

    const backtestingConfig = {
      strictFutures: options.strictFutures,
      start: options.start,
      end: options.end,
      initialCash: options.initialCash,
      cost: options.cost,
      locale: this.input.locale,
      strategy: {
        ...this.sandbox.metadata,
        onBar: (context: EngineContext) => this.sandbox.execute({ context }),
      },
      dataPort: this.input.dataPort,
      factorExecution: this.factorHost,
      onLog: this.input.onLog,
    };
    this.engine = new BacktestingEngine(backtestingConfig);
    const result: BacktestResult = await this.engine.run();
    if (this.input.factors) {
      result.factorDependencies = this.factorDependencies;
    }
    return result;
  }

  /**
   * 在关闭模拟会话前读取末日独立快照，必要时补载市场数据。
   * Collect a detached snapshot, including market-data loading, before closing this simulation.
   */
  async collectFinalState(): Promise<BacktestingFinalState> {
    if (this.closed || !this.engine) {
      throw new Error('Final state requires an open execution with an engine run');
    }

    return this.engine.collectFinalState();
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.factorHost.close();
    } finally {
      this.sandbox.close();
    }
  }
}
