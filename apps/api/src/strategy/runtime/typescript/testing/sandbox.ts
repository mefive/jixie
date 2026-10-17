import { TypeScriptTransport } from '#infra/runtime/typescript/typescript-transport.js';
import type { TypeScriptTransportMetrics } from '#infra/runtime/typescript/typescript-transport.js';
import { StrategySandbox } from '../../strategy-sandbox.js';
import { StrategyBridge } from '../../strategy-bridge.js';
import type { StrategyBridgeOptions, StrategyTransport } from '../../strategy-bridge.js';
import type { StrategyStartOptions } from '../../contract.js';

/** Test instrumentation keeps transport diagnostics outside the production sandbox interface. */
class InstrumentedStrategySandbox extends StrategySandbox {
  private diagnostics!: TypeScriptTransportMetrics;

  static async startInstrumented(options: StrategyStartOptions) {
    const sandbox = new InstrumentedStrategySandbox({ ...options, language: 'typescript' });
    await sandbox.initialize();

    return { sandbox, metrics: sandbox.diagnostics };
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

export function startInstrumentedStrategySandbox(options: StrategyStartOptions) {
  return InstrumentedStrategySandbox.startInstrumented(options);
}
