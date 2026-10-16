import { TypeScriptTransport } from '#infra/runtime/typescript/typescript-transport.js';
import type { TypeScriptTransportMetrics } from '#infra/runtime/typescript/typescript-transport.js';
import { StrategyRuntime } from '../../strategy-runtime.js';
import { StrategyBridge } from '../../strategy-bridge.js';
import type { StrategyBridgeOptions, StrategyTransport } from '../../strategy-bridge.js';
import type { StrategyStartOptions } from '../../contract.js';

/** Test instrumentation keeps transport diagnostics outside the production runtime interface. */
class InstrumentedStrategyRuntime extends StrategyRuntime {
  private diagnostics!: TypeScriptTransportMetrics;

  static async startInstrumented(options: StrategyStartOptions) {
    const runtime = new InstrumentedStrategyRuntime({ ...options, language: 'typescript' });
    await runtime.initialize();

    return { runtime, metrics: runtime.diagnostics };
  }

  protected createBridge() {
    const captureMetrics = (metrics: TypeScriptTransportMetrics) => {
      this.diagnostics = metrics;
    };

    class InstrumentedBridge extends StrategyBridge {
      constructor(transport: StrategyTransport, options: StrategyBridgeOptions) {
        super(transport, options);

        if (!(transport instanceof TypeScriptTransport)) {
          throw new Error('Strategy instrumentation requires a TypeScript transport');
        }
        captureMetrics(transport.metrics);
      }
    }

    return InstrumentedBridge.create(this.options);
  }
}

export function startInstrumentedStrategyRuntime(options: StrategyStartOptions) {
  return InstrumentedStrategyRuntime.startInstrumented(options);
}
