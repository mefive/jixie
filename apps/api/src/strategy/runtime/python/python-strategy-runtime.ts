import { SandboxRuntime, startSandboxRuntime } from '#infra/runtime/sandbox-runtime.js';
import { PythonSession } from '#infra/runtime/python/session.js';
import { createStrategyBridge, type StrategyBridge } from '../bridge.js';
import type {
  StrategyStartOptions,
  StrategyExecutionInput,
  StrategyRuntimeMetadata,
} from '../contract.js';

export class PythonStrategyRuntime extends SandboxRuntime<
  StrategyExecutionInput,
  void,
  StrategyRuntimeMetadata
> {
  private constructor(
    session: PythonSession,
    private readonly bridge: StrategyBridge,
  ) {
    super(session, bridge.metadata);
  }

  static start({
    code,
    onUserLog,
    paramOverrides,
    locale,
  }: StrategyStartOptions): Promise<PythonStrategyRuntime> {
    return startSandboxRuntime({
      createResource: () => PythonSession.connect(),
      initialize: async (session) => {
        const bridge = await createStrategyBridge(session, {
          startupCommand: {
            type: 'start',
            runtime_version: 'py-v1',
            code,
            param_overrides: paramOverrides ?? {},
          },
          diagnostics: { language: 'Python', callback: 'on_bar' },
          onUserLog,
          locale,
        });
        return new PythonStrategyRuntime(session, bridge);
      },
    });
  }

  protected executeInSandbox({ context }: StrategyExecutionInput): Promise<void> {
    return this.bridge.execute(context);
  }
}
