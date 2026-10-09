import type { StrategyDefinition } from '../../sdk/capabilities.js';
import { StrategyAdapter, type StrategyAdapterInput } from './adapter.js';
import type { Locale, StrategyParamValue } from '@jixie/shared';
import {
  makeSandboxConsole,
  noopSandboxConsole,
  type SandboxConsole,
} from '#infra/runtime/console.js';
import {
  defineStrategy,
  StrategyContext,
  applyStrategyParamOverrides,
} from '../../sdk/typescript.js';

export interface StrategyRunnerHost {
  receive(handler: StrategyRunnerCommandHandler): void;
  emit(frame: Record<string, unknown>): void;
  access(json: string): string;
}

interface StrategyRunnerStartup {
  userJs: string;
  paramOverrides?: Record<string, StrategyParamValue>;
  locale?: Locale;
  captureUserLogs: boolean;
}

type StrategyHostResponse = { id: number } & ({ result: unknown } | { error: string });

export type StrategyRunnerCommand =
  | ({ type: 'start' } & StrategyRunnerStartup)
  | { type: 'bar'; snapshot: StrategyAdapterInput }
  | ({ type: 'response' } & StrategyHostResponse);

export type StrategyRunnerCommandHandler = (
  frame: StrategyRunnerCommand,
) => string | Promise<string> | void;

/** One instance owns one sandbox session and all state shared across its callbacks. */
class StrategyRunner {
  private strategy!: StrategyDefinition;
  private readonly adapter: StrategyAdapter;
  private requestId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  constructor(private readonly host: StrategyRunnerHost) {
    this.adapter = new StrategyAdapter({
      access: (json) => this.host.access(json),
      request: (args) => this.request('context_data', args),
    });
  }

  handle(frame: StrategyRunnerCommand): string | Promise<string> | void {
    const type = frame.type;

    switch (frame.type) {
      case 'start':
        return this.start(frame);
      case 'bar':
        return this.execute(frame.snapshot);
      case 'response':
        return this.receiveResponse(frame);
      default:
        throw new Error(`Unsupported strategy command: ${type}`);
    }
  }

  start(config: StrategyRunnerStartup) {
    const console = config.captureUserLogs
      ? makeSandboxConsole(
          (level, text) => {
            this.host.emit({ type: 'log', level: level === 'warn' ? 'warning' : level, text });
          },
          2_000,
          config.locale,
        )
      : noopSandboxConsole;

    this.strategy = this.loadStrategy(config.userJs, console);
    applyStrategyParamOverrides(this.strategy, config.paramOverrides);

    return JSON.stringify({
      type: 'ready',
      metadata: this.metadata(),
    });
  }

  private async execute(snapshot: StrategyAdapterInput) {
    const capabilities = this.adapter.bind(snapshot);
    const context = new StrategyContext(capabilities, this.strategy.params);

    await this.strategy.onBar(context);

    return JSON.stringify({ type: 'done', commands: [] });
  }

  private loadStrategy(userJs: string, sandboxConsole: SandboxConsole): StrategyDefinition {
    const module: { exports: Record<string, unknown> } = { exports: {} };

    try {
      const evaluate = new Function(
        'module',
        'exports',
        'defineStrategy',
        'console',
        'require',
        userJs,
      );
      evaluate(module, module.exports, defineStrategy, sandboxConsole, (id: string) => {
        throw new Error(
          `strategy code cannot import external modules (${id}) — all capabilities are on ctx`,
        );
      });
    } catch (error) {
      throw new Error(
        `strategy code execution error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const result = (module.exports.default ?? module.exports) as Partial<StrategyDefinition>;
    if (!result || typeof result.onBar !== 'function') {
      throw new Error('strategy must `export default defineStrategy({ onBar(ctx) { … } })`');
    }
    result.name ||= 'Untitled strategy';

    return result as StrategyDefinition;
  }

  private metadata() {
    return {
      name: this.strategy.name,
      params: this.strategy.params ?? {},
      factors: this.strategy.factors ?? [],
      watch: this.strategy.watch ?? [],
      futures: [],
      accounts: this.strategy.accounts ?? null,
    };
  }

  private request(method: string, args: Record<string, unknown>): Promise<unknown> {
    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.host.emit({ type: 'request', id, method, arguments: args });
    });
  }

  private receiveResponse(reply: StrategyHostResponse) {
    const waiting = this.pending.get(reply.id);
    if (!waiting) {
      throw new Error('Unexpected strategy response ID');
    }
    this.pending.delete(reply.id);
    if ('error' in reply) {
      waiting.reject(new Error(reply.error));
    } else {
      waiting.resolve(reply.result);
    }
  }
}

/** Start one strategy session and attach its message handler to the injected transport. */
export function runStrategy(start: StrategyRunnerStartup, host: StrategyRunnerHost): string {
  const runner = new StrategyRunner(host);
  const ready = runner.start(start);

  host.receive((frame) => runner.handle(frame));

  return ready;
}
