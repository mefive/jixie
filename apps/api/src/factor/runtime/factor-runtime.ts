import { SandboxRuntime } from '#infra/runtime/sandbox-runtime.js';
import { FactorBridge } from './bridge.js';
import type {
  ExecutableFactorKind,
  FactorStartOptions,
  FactorRuntimeInstance,
  FactorExecutionInput,
  FactorRuntimeMetadata,
  FactorValues,
  FactorBridgeContract,
} from './contract.js';

/** Owns one factor sandbox, independently of its language and transport. */
export class FactorRuntime<Kind extends ExecutableFactorKind> extends SandboxRuntime<
  FactorExecutionInput<Kind>,
  FactorValues,
  FactorRuntimeMetadata<Kind>
> {
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

  protected createBridge(): Promise<FactorBridgeContract<Kind>> {
    return FactorBridge.create(this.options, this);
  }
}
