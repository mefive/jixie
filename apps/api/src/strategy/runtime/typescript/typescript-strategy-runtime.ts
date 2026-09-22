import { DEFAULT_LOCALE } from '@jixie/shared';
import { SandboxRuntime, startSandboxRuntime } from '#infra/runtime/sandbox-runtime.js';
import { TypeScriptTransport } from '#infra/runtime/typescript/transport.js';
import { toCommonJs } from '#infra/runtime/typescript/isolate-run.js';
import { createStrategyBridge, type StrategyBridge } from '../bridge.js';
import type {
  StrategyStartOptions,
  StrategyExecutionInput,
  StrategyRuntimeMetadata,
} from '../contract.js';
import { buildStrategySandboxBundle } from './sandbox-bundle.js';

let bundlePromise: Promise<string> | undefined;

export class TypeScriptStrategyRuntime extends SandboxRuntime<
  StrategyExecutionInput,
  void,
  StrategyRuntimeMetadata
> {
  private constructor(
    private readonly transport: TypeScriptTransport,
    private readonly bridge: StrategyBridge,
  ) {
    super(transport, bridge.metadata);
  }

  static async start({
    code,
    onUserLog,
    paramOverrides,
    locale = DEFAULT_LOCALE,
  }: StrategyStartOptions): Promise<TypeScriptStrategyRuntime> {
    const userJs = await toCommonJs(code, 'strategy code');
    bundlePromise ??= buildStrategySandboxBundle().then((bundle) => bundle.outputFiles[0].text);
    const bundle = await bundlePromise;
    const deadline = Date.now() + 3_600_000;
    return startSandboxRuntime({
      createResource: () =>
        TypeScriptTransport.connect({
          bundle,
          description: 'strategy code',
          memoryMb: 1024,
          allowHostAccess: true,
          commandTimeoutMs: (frame) =>
            frame.type === 'start' ? 5_000 : Math.max(1, deadline - Date.now()),
        }),
      initialize: async (transport) => {
        const bridge = await createStrategyBridge(transport, {
          startupCommand: {
            type: 'start',
            userJs,
            paramOverrides,
            locale,
            captureUserLogs: onUserLog != null,
          },
          historyUpdates: true,
          diagnostics: { language: 'TypeScript', callback: 'onBar' },
          onUserLog,
          locale,
        });
        return new TypeScriptStrategyRuntime(transport, bridge);
      },
    });
  }

  get metrics() {
    return this.transport.metrics;
  }

  protected executeInSandbox({ context }: StrategyExecutionInput): Promise<void> {
    return this.bridge.execute(context);
  }
}
