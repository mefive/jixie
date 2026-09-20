import ivm from 'isolated-vm';
import type { z } from 'zod';
import {
  DEFAULT_LOCALE,
  type Locale,
  type StrategyParamValue,
  type StrategySignalMetadata,
} from '@jixie/shared';
import { UserCodeError } from '#infra/errors.js';
import type { UserLogSink } from '#infra/runtime/console.js';
import { toCommonJs } from '#infra/runtime/typescript/isolate-run.js';
import type { Strategy } from '#engine/types.js';
import { createStrategyBridge, type StrategyTransport } from '../bridge.js';
import { buildStrategySandboxBundle } from './sandbox-bundle.js';

const MAX_FRAME_BYTES = 64 * 1024 * 1024;
let bundlePromise: Promise<string> | undefined;
function sandboxBundle(): Promise<string> {
  bundlePromise ??= buildStrategySandboxBundle().then((bundle) => bundle.outputFiles[0].text);
  return bundlePromise;
}

/** Counters support fixture benchmarks without adding instrumentation to user APIs. */
export interface StrategyTransportMetrics {
  sentFrames: number;
  receivedFrames: number;
  synchronousCalls: number;
  transferredBytes: number;
}

class TypeScriptTransport implements StrategyTransport {
  readonly historyUpdates = true;
  private readonly isolate = new ivm.Isolate({ memoryLimit: 1024 });
  private context?: ivm.Context;
  private readonly references: ivm.Reference[] = [];
  private readonly frames: Array<{ frame: unknown; bytes: number }> = [];
  private queuedBytes = 0;
  private reader?: { resolve: (frame: unknown) => void; reject: (error: Error) => void };
  private access?: (input: unknown) => unknown;
  private failure?: Error;
  private running = false;
  private readonly deadline = Date.now() + 3_600_000;
  readonly metrics: StrategyTransportMetrics = {
    sentFrames: 0,
    receivedFrames: 0,
    synchronousCalls: 0,
    transferredBytes: 0,
  };

  async start(
    userJs: string,
    paramOverrides: Record<string, StrategyParamValue> | undefined,
    locale: Locale,
    captureUserLogs: boolean,
  ): Promise<void> {
    try {
      this.context = await this.isolate.createContext();
      const emit = new ivm.Reference((json: string) => {
        this.enqueue(this.decode(json));
        return '';
      });
      const access = new ivm.Reference((json: string) => {
        this.metrics.synchronousCalls++;
        try {
          if (!this.access || this.failure) {
            throw new Error('Strategy context is unavailable outside onBar');
          }
          const result = this.access(this.decode(json));
          return this.encode({ result });
        } catch (error) {
          return this.encode({ error: error instanceof Error ? error.message : String(error) });
        }
      });
      this.references.push(emit, access);
      await this.context.global.set('__hostEmit', emit);
      await this.context.global.set('__hostAccess', access);
      await this.context.eval(await sandboxBundle(), { timeout: 60_000 });
      const result = await this.call(
        '__startStrategy',
        { userJs, paramOverrides, locale, captureUserLogs },
        5_000,
      );
      this.enqueue(this.decode(result));
    } catch (cause) {
      this.close();
      throw new UserCodeError(cause instanceof Error ? cause.message : String(cause), { cause });
    }
  }

  setContextAccess(handler: ((input: unknown) => unknown) | undefined): void {
    this.access = handler;
  }

  async send(frame: { type: string; [key: string]: unknown }): Promise<void> {
    if (this.failure) {
      throw this.failure;
    }
    this.metrics.sentFrames++;
    switch (frame.type) {
      case 'bar': {
        if (this.running) {
          throw new Error('A strategy callback is already running');
        }
        this.running = true;
        // Do not await: the bridge must answer requests while onBar is suspended in the isolate.
        void this.call(
          '__runStrategyBar',
          frame.snapshot,
          Math.max(1, this.deadline - Date.now()),
        ).then(
          (json) => {
            this.running = false;
            try {
              this.enqueue(this.decode(json));
            } catch (error) {
              this.abort(error);
            }
          },
          (error) => {
            this.running = false;
            this.abort(error);
          },
        );
        break;
      }
      case 'response':
        await this.call('__receiveResponse', frame, Math.max(1, this.deadline - Date.now()));
        break;
      default:
        throw new Error(`Unsupported strategy transport frame: ${frame.type}`);
    }
  }

  async readValidated<Frame>(schema: z.ZodType<Frame>, operation: string): Promise<Frame> {
    if (this.failure) {
      throw this.failure;
    }
    let frame: unknown;
    const queued = this.frames.shift();
    if (queued) {
      this.queuedBytes -= queued.bytes;
      frame = queued.frame;
    } else {
      frame = await new Promise<unknown>((resolve, reject) => {
        if (this.reader) {
          reject(new Error('Concurrent strategy frame readers are unsupported'));
          return;
        }
        this.reader = { resolve, reject };
      });
    }
    const result = schema.safeParse(frame);
    if (!result.success) {
      const error = new UserCodeError(
        `invalid TypeScript sandbox protocol while ${operation}: ${result.error.message}`,
      );
      this.abort(error);
      throw error;
    }
    this.metrics.receivedFrames++;
    return result.data;
  }

  close(): void {
    this.abort(new Error('TypeScript strategy runtime closed'));
  }

  private abort(cause: unknown): void {
    if (this.failure) {
      return;
    }
    this.failure = cause instanceof Error ? cause : new Error(String(cause));
    this.access = undefined;
    this.frames.length = 0;
    this.queuedBytes = 0;
    this.reader?.reject(this.failure);
    this.reader = undefined;
    for (const reference of this.references) {
      reference.release();
    }
    if (!this.isolate.isDisposed) {
      this.isolate.dispose();
    }
  }

  private enqueue(frame: unknown): void {
    if (this.failure) {
      return;
    }
    if (this.reader) {
      const reader = this.reader;
      this.reader = undefined;
      reader.resolve(frame);
    } else {
      const bytes = Buffer.byteLength(JSON.stringify(frame));
      if (this.frames.length >= 10_000 || this.queuedBytes + bytes > MAX_FRAME_BYTES) {
        throw new Error('Strategy frame queue limit exceeded');
      }
      this.queuedBytes += bytes;
      this.frames.push({ frame, bytes });
    }
  }

  private encode(value: unknown): string {
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > MAX_FRAME_BYTES) {
      throw new Error('Strategy frame is too large');
    }
    this.metrics.transferredBytes += Buffer.byteLength(json);
    return json;
  }

  private decode(json: string): unknown {
    if (typeof json !== 'string' || Buffer.byteLength(json) > MAX_FRAME_BYTES) {
      throw new Error('Invalid strategy frame size');
    }
    this.metrics.transferredBytes += Buffer.byteLength(json);
    return JSON.parse(json);
  }

  private async call(entry: string, argument: unknown, timeout: number): Promise<string> {
    const result = await this.context!.evalClosure(
      `return globalThis[${JSON.stringify(entry)}]($0)`,
      [this.encode(argument)],
      {
        arguments: { copy: true },
        result: { promise: true, copy: true },
        timeout,
      },
    );
    // Response delivery returns no payload; only startup and completed bars return frames.
    return typeof result === 'string' ? result : '';
  }
}

export interface TypeScriptStrategyRuntime {
  strategy: Strategy;
  metrics: StrategyTransportMetrics;
  close(): Promise<void>;
}

export async function createTypeScriptStrategyRuntime(
  code: string,
  onUserLog?: UserLogSink,
  paramOverrides?: Record<string, StrategyParamValue>,
  locale: Locale = DEFAULT_LOCALE,
): Promise<TypeScriptStrategyRuntime> {
  const userJs = await toCommonJs(code, 'strategy code');
  const transport = new TypeScriptTransport();
  try {
    await transport.start(userJs, paramOverrides, locale, onUserLog != null);
    const strategy = await createStrategyBridge(transport, {
      diagnostics: { language: 'TypeScript', callback: 'onBar' },
      onUserLog,
      locale,
    });
    return {
      strategy,
      metrics: transport.metrics,
      async close() {
        transport.close();
      },
    };
  } catch (error) {
    transport.close();
    throw error;
  }
}

export async function inspectStrategyParameters(
  code: string,
): Promise<Record<string, StrategyParamValue>> {
  const runtime = await createTypeScriptStrategyRuntime(code);
  try {
    return runtime.strategy.params ?? {};
  } finally {
    await runtime.close();
  }
}

export async function inspectStrategyMetadata(code: string): Promise<StrategySignalMetadata> {
  const runtime = await createTypeScriptStrategyRuntime(code);
  try {
    return {
      watch: runtime.strategy.watch ?? [],
      futures: runtime.strategy.futures ?? [],
      factors: runtime.strategy.factors ?? [],
    };
  } finally {
    await runtime.close();
  }
}
