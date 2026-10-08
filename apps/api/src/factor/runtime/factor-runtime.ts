import { SandboxRuntime, startSandboxRuntime } from '#infra/runtime/sandbox-runtime.js';
import type { SandboxResource } from '#infra/runtime/sandbox-runtime.js';
import { createFactorBridge } from './bridge.js';
import type { FactorBridge, FactorTransport } from './bridge.js';
import { preparePythonFactorRuntime } from './python/prepare.js';
import { prepareTypeScriptFactorRuntime } from './typescript/prepare.js';
import type {
  ExecutableFactorKind,
  FactorStartOptions,
  FactorRuntimeInstance,
  FactorExecutionInput,
  FactorRuntimeMetadata,
  FactorRuntimePreparation,
  FactorValues,
} from './contract.js';

/** Owns one factor sandbox, independently of its language and transport. */
export class FactorRuntime<Kind extends ExecutableFactorKind> extends SandboxRuntime<
  FactorExecutionInput<Kind>,
  FactorValues,
  FactorRuntimeMetadata<Kind>
> {
  constructor(
    resource: FactorTransport & SandboxResource,
    private readonly bridge: FactorBridge<Kind>,
  ) {
    super(resource, bridge.metadata);
  }

  static start<Kind extends ExecutableFactorKind>(
    options: FactorStartOptions<Kind>,
  ): Promise<FactorRuntimeInstance<Kind>>;
  static start(options: FactorStartOptions): Promise<FactorRuntimeInstance> {
    switch (options.analysisKind) {
      case 'cross_sectional':
        return FactorRuntime.startForKind({ ...options, analysisKind: 'cross_sectional' });
      case 'time_series':
        return FactorRuntime.startForKind({ ...options, analysisKind: 'time_series' });
      case 'panel':
        return FactorRuntime.startForKind({ ...options, analysisKind: 'panel' });
    }
  }

  private static async startForKind<Kind extends ExecutableFactorKind>(
    options: FactorStartOptions<Kind>,
  ) {
    const preparation: FactorRuntimePreparation<Kind> =
      options.language === 'python'
        ? preparePythonFactorRuntime(options)
        : await prepareTypeScriptFactorRuntime(options);

    return startSandboxRuntime({
      createResource: preparation.createResource,
      initialize: async (resource) => {
        const bridge = await createFactorBridge(resource, preparation.bridgeOptions);

        return new FactorRuntime(resource, bridge);
      },
    });
  }

  protected executeInSandbox(input: FactorExecutionInput<Kind>): Promise<FactorValues> {
    return this.bridge.execute(input, (error) => this.abort(error));
  }
}
