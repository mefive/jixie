import { Sandbox } from '#infra/sandbox/sandbox.js';
import { StrategyBridge } from './strategy-bridge.js';
import type {
  StrategyStartOptions,
  StrategySandboxInstance,
  StrategyDecisionInput,
  StrategySandboxMetadata,
} from './contract.js';

/** Owns one strategy sandbox, independently of its language and transport. */
export class StrategySandbox extends Sandbox<StrategyDecisionInput, void, StrategySandboxMetadata> {
  protected constructor(protected readonly options: StrategyStartOptions) {
    super();
  }

  static async start(options: StrategyStartOptions): Promise<StrategySandboxInstance> {
    const sandbox = new StrategySandbox(options);
    await sandbox.initialize();

    return sandbox;
  }

  protected createBridge(): Promise<StrategyBridge> {
    return StrategyBridge.create(this.options);
  }
}
