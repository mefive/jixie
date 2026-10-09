import { SandboxRuntime } from '#infra/runtime/sandbox-runtime.js';
import type { SandboxResource } from '#infra/runtime/sandbox-runtime.js';
import { createFactorBridge } from './bridge.js';
import type { FactorBridge, FactorBridgeOptions, FactorTransport } from './bridge.js';
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
  FactorRuntimeMetadata<Kind>,
  FactorTransport & SandboxResource
> {
  private bridgeOptions!: FactorBridgeOptions<Kind>;
  private bridge!: FactorBridge<Kind>;

  private constructor(private readonly options: FactorStartOptions<Kind>) {
    super();
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
    const runtime = new FactorRuntime(options);
    await runtime.initialize();

    return runtime;
  }

  protected async createResource(): Promise<FactorTransport & SandboxResource> {
    let preparation: FactorRuntimePreparation<Kind>;
    if (this.options.language === 'python') {
      preparation = preparePythonFactorRuntime(this.options);
    } else {
      preparation = await prepareTypeScriptFactorRuntime(this.options);
    }
    this.bridgeOptions = preparation.bridgeOptions;

    return preparation.createResource();
  }

  protected async initializeInSandbox(
    resource: FactorTransport & SandboxResource,
  ): Promise<FactorRuntimeMetadata<Kind>> {
    this.bridge = await createFactorBridge(resource, this.bridgeOptions);

    return this.bridge.metadata;
  }

  protected executeInSandbox(input: FactorExecutionInput<Kind>): Promise<FactorValues> {
    return this.bridge.execute(input, (error) => this.abort(error));
  }
}
