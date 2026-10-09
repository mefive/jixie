import { TypeScriptTransport } from '#infra/runtime/typescript/transport.js';
import type { TypeScriptTransportMetrics } from '#infra/runtime/typescript/transport.js';
import { StrategyRuntime } from '../../strategy-runtime.js';
import type { StrategyStartOptions } from '../../contract.js';

/** Test instrumentation keeps transport diagnostics outside the production runtime interface. */
class InstrumentedStrategyRuntime extends StrategyRuntime {
  private diagnostics!: TypeScriptTransportMetrics;

  static async startInstrumented(options: StrategyStartOptions) {
    const runtime = new InstrumentedStrategyRuntime({ ...options, language: 'typescript' });
    await runtime.initialize();

    return { runtime, metrics: runtime.diagnostics };
  }

  protected async createResource() {
    const transport = await super.createResource();
    if (!(transport instanceof TypeScriptTransport)) {
      transport.close();
      throw new Error('Strategy instrumentation requires a TypeScript transport');
    }
    this.diagnostics = transport.metrics;

    return transport;
  }
}

export function startInstrumentedStrategyRuntime(options: StrategyStartOptions) {
  return InstrumentedStrategyRuntime.startInstrumented(options);
}
