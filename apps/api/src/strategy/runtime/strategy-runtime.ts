import { SandboxRuntime } from '#infra/runtime/sandbox-runtime.js';
import type { SandboxResource } from '#infra/runtime/sandbox-runtime.js';
import { StrategyBridge } from './bridge.js';
import type { StrategyBridgeOptions, StrategyTransport } from './bridge.js';
import { preparePythonStrategyRuntime } from './python/prepare.js';
import { prepareTypeScriptStrategyRuntime } from './typescript/prepare.js';
import type {
  StrategyStartOptions,
  StrategyRuntimeInstance,
  StrategyExecutionInput,
  StrategyRuntimeMetadata,
  StrategyRuntimePreparation,
} from './contract.js';

/** Owns one strategy sandbox, independently of its language and transport. */
export class StrategyRuntime extends SandboxRuntime<
  StrategyExecutionInput,
  void,
  StrategyRuntimeMetadata,
  StrategyTransport & SandboxResource
> {
  private bridgeOptions!: StrategyBridgeOptions;
  private bridge!: StrategyBridge;

  protected constructor(private readonly options: StrategyStartOptions) {
    super();
  }

  static async start(options: StrategyStartOptions): Promise<StrategyRuntimeInstance> {
    const runtime = new StrategyRuntime(options);
    await runtime.initialize();

    return runtime;
  }

  protected async createResource(): Promise<StrategyTransport & SandboxResource> {
    let preparation: StrategyRuntimePreparation;
    if (this.options.language === 'python') {
      preparation = preparePythonStrategyRuntime(this.options);
    } else {
      preparation = await prepareTypeScriptStrategyRuntime(this.options);
    }
    this.bridgeOptions = preparation.bridgeOptions;

    return preparation.createResource();
  }

  protected async initializeInSandbox(
    resource: StrategyTransport & SandboxResource,
  ): Promise<StrategyRuntimeMetadata> {
    this.bridge = new StrategyBridge(resource, this.bridgeOptions);

    return this.bridge.initialize();
  }

  protected executeInSandbox({ context }: StrategyExecutionInput): Promise<void> {
    return this.bridge.execute(context);
  }
}
