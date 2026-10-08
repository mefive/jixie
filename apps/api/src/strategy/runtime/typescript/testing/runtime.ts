import { startSandboxRuntime } from '#infra/runtime/sandbox-runtime.js';
import { createStrategyBridge } from '../../bridge.js';
import { StrategyRuntime } from '../../strategy-runtime.js';
import type { StrategyStartOptions } from '../../contract.js';
import { prepareTypeScriptStrategyRuntime } from '../prepare.js';

/** Test instrumentation keeps transport diagnostics outside the production runtime interface. */
export async function startInstrumentedStrategyRuntime(options: StrategyStartOptions) {
  const preparation = await prepareTypeScriptStrategyRuntime(options);

  return startSandboxRuntime({
    createResource: preparation.createResource,
    initialize: async (transport) => {
      const bridge = await createStrategyBridge(transport, preparation.bridgeOptions);
      const runtime = new StrategyRuntime(transport, bridge);

      return { runtime, metrics: transport.metrics };
    },
  });
}
