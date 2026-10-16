import { SandboxRuntime } from '#infra/runtime/sandbox-runtime.js';
import { StrategyBridge } from './bridge.js';
import type {
  StrategyStartOptions,
  StrategyRuntimeInstance,
  StrategyExecutionInput,
  StrategyRuntimeMetadata,
  StrategyBridgeContract,
} from './contract.js';

/** Owns one strategy sandbox, independently of its language and transport. */
export class StrategyRuntime extends SandboxRuntime<
  StrategyExecutionInput,
  void,
  StrategyRuntimeMetadata
> {
  protected constructor(protected readonly options: StrategyStartOptions) {
    super();
  }

  static async start(options: StrategyStartOptions): Promise<StrategyRuntimeInstance> {
    const runtime = new StrategyRuntime(options);
    await runtime.initialize();

    return runtime;
  }

  protected createBridge(): Promise<StrategyBridgeContract> {
    return StrategyBridge.create(this.options);
  }
}
