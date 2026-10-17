import { Sandbox } from '#infra/sandbox/sandbox.js';
import { FactorBridge } from './factor-bridge.js';
import type {
  ExecutableFactorKind,
  FactorStartOptions,
  FactorSandboxInstance,
  FactorComputeInput,
  FactorSandboxMetadata,
  FactorValues,
} from './contract.js';

/** Owns one factor sandbox, independently of its language and transport. */
export class FactorSandbox<Kind extends ExecutableFactorKind> extends Sandbox<
  FactorComputeInput<Kind>,
  FactorValues,
  FactorSandboxMetadata<Kind>
> {
  private constructor(private readonly options: FactorStartOptions<Kind>) {
    super();
  }

  static start<Kind extends ExecutableFactorKind>(
    options: FactorStartOptions<Kind>,
  ): Promise<FactorSandboxInstance<Kind>>;

  /**
   * 创建因子会话后等待基类初始化，失败或取消时统一回收。
   *
   * Create and initialize a factor session with shared failure and cancellation cleanup.
   */
  static start(options: FactorStartOptions): Promise<FactorSandboxInstance> {
    switch (options.analysisKind) {
      case 'cross_sectional':
        return FactorSandbox.startForKind({ ...options, analysisKind: 'cross_sectional' });
      case 'time_series':
        return FactorSandbox.startForKind({ ...options, analysisKind: 'time_series' });
      case 'panel':
        return FactorSandbox.startForKind({ ...options, analysisKind: 'panel' });
    }
  }

  private static async startForKind<Kind extends ExecutableFactorKind>(
    options: FactorStartOptions<Kind>,
  ) {
    const sandbox = new FactorSandbox(options);
    await sandbox.initialize();

    return sandbox;
  }

  protected createBridge(): Promise<FactorBridge<Kind>> {
    return FactorBridge.create(this.options, this);
  }
}
