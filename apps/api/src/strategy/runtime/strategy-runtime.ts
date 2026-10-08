import { SandboxRuntime, startSandboxRuntime } from '#infra/runtime/sandbox-runtime.js';
import type { SandboxResource } from '#infra/runtime/sandbox-runtime.js';
import { createStrategyBridge } from './bridge.js';
import type { StrategyBridge, StrategyTransport } from './bridge.js';
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
  StrategyRuntimeMetadata
> {
  constructor(
    resource: StrategyTransport & SandboxResource,
    private readonly bridge: StrategyBridge,
  ) {
    super(resource, bridge.metadata);
  }

  static async start(options: StrategyStartOptions): Promise<StrategyRuntimeInstance> {
    const preparation: StrategyRuntimePreparation =
      options.language === 'python'
        ? preparePythonStrategyRuntime(options)
        : await prepareTypeScriptStrategyRuntime(options);

    return startSandboxRuntime({
      createResource: preparation.createResource,
      initialize: async (resource) => {
        const bridge = await createStrategyBridge(resource, preparation.bridgeOptions);

        return new StrategyRuntime(resource, bridge);
      },
    });
  }

  protected executeInSandbox({ context }: StrategyExecutionInput): Promise<void> {
    return this.bridge.execute(context);
  }
}
