import ivm from 'isolated-vm';
import type { z } from 'zod';
import { UserCodeError } from '#infra/errors.js';
import type { SandboxFrame, SandboxTransport } from '../exchange.js';

const DEFAULT_MAX_FRAME_BYTES = 64 * 1024 * 1024;

export interface TypeScriptTransportMetrics {
  sentFrames: number;
  receivedFrames: number;
  synchronousCalls: number;
  transferredBytes: number;
}

export interface TypeScriptTransportOptions {
  bundle: string;
  description: string;
  memoryMb: number;
  commandTimeoutMs(frame: SandboxFrame): number;
  maxFrameBytes?: number;
  maxQueuedFrames?: number;
  allowHostAccess?: boolean;
}

export class TypeScriptTransport implements SandboxTransport {
  private readonly isolate: ivm.Isolate;
  private context?: ivm.Context;
  private readonly references: ivm.Reference[] = [];
  private readonly frames: Array<{ frame: unknown; bytes: number }> = [];
  private queuedBytes = 0;
  private reader?: { resolve: (frame: unknown) => void; reject: (error: Error) => void };
  private access?: (input: unknown) => unknown;
  private failure?: Error;
  private running = false;
  readonly metrics: TypeScriptTransportMetrics = {
    sentFrames: 0,
    receivedFrames: 0,
    synchronousCalls: 0,
    transferredBytes: 0,
  };

  private constructor(private readonly options: TypeScriptTransportOptions) {
    this.isolate = new ivm.Isolate({ memoryLimit: options.memoryMb });
  }

  static async connect(options: TypeScriptTransportOptions): Promise<TypeScriptTransport> {
    const transport = new TypeScriptTransport(options);
    try {
      await transport.initialize();
      return transport;
    } catch (error) {
      transport.close();
      throw error;
    }
  }

  get isClosed(): boolean {
    return this.failure !== undefined;
  }

  private async initialize(): Promise<void> {
    this.context = await this.isolate.createContext();
    const emit = new ivm.Reference((json: string) => {
      try {
        this.enqueue(this.decode(json));
      } catch (error) {
        this.abort(error);
        throw error;
      }
      return '';
    });
    this.references.push(emit);
    await this.context.global.set('__hostEmit', emit);
    if (this.options.allowHostAccess) {
      const access = new ivm.Reference((json: string) => {
        this.metrics.synchronousCalls++;
        try {
          if (!this.access || this.failure) {
            throw new Error('Sandbox host context is unavailable outside execution');
          }
          return this.encode({ result: this.access(this.decode(json)) });
        } catch (error) {
          return this.encode({ error: error instanceof Error ? error.message : String(error) });
        }
      });
      this.references.push(access);
      await this.context.global.set('__hostAccess', access);
    }
    await this.context.eval(this.options.bundle, { timeout: 60_000 });
  }

  setHostAccess(handler: ((input: unknown) => unknown) | undefined): void {
    this.access = handler;
  }

  async send(frame: { type: string; [key: string]: unknown }): Promise<void> {
    if (this.failure) {
      throw this.failure;
    }
    this.metrics.sentFrames++;
    const timeout = this.options.commandTimeoutMs(frame);
    if (frame.type === 'response') {
      await this.call(frame, timeout);
      return;
    }
    if (this.running) {
      throw new Error('A sandbox command is already running');
    }
    this.running = true;
    // Sending must return before execution finishes so host requests can receive responses.
    void this.call(frame, timeout).then(
      (json) => {
        this.running = false;
        try {
          this.enqueue(this.decode(json));
        } catch (error) {
          this.abort(error);
        }
      },
      (cause) => {
        this.running = false;
        this.abort(
          new UserCodeError(
            `${this.options.description} execution error: ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause },
          ),
        );
      },
    );
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
          reject(new Error('Concurrent sandbox frame readers are unsupported'));
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
    this.abort(new Error('TypeScript sandbox transport closed'));
  }

  abort(cause: unknown): void {
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
      if (
        this.frames.length >= (this.options.maxQueuedFrames ?? 10_000) ||
        this.queuedBytes + bytes > (this.options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES)
      ) {
        throw new Error('Sandbox frame queue limit exceeded');
      }
      this.queuedBytes += bytes;
      this.frames.push({ frame, bytes });
    }
  }

  private encode(value: unknown): string {
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > (this.options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES)) {
      throw new Error('Sandbox frame is too large');
    }
    this.metrics.transferredBytes += Buffer.byteLength(json);
    return json;
  }

  private decode(json: string): unknown {
    if (
      typeof json !== 'string' ||
      Buffer.byteLength(json) > (this.options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES)
    ) {
      throw new Error('Invalid sandbox frame size');
    }
    this.metrics.transferredBytes += Buffer.byteLength(json);
    return JSON.parse(json);
  }

  private async call(argument: SandboxFrame, timeout: number): Promise<string> {
    const result = await this.context!.evalClosure(
      'return globalThis.__receiveCommand($0)',
      [this.encode(argument)],
      {
        arguments: { copy: true },
        result: { promise: true, copy: true },
        timeout,
      },
    );
    // Response delivery returns no payload; completed commands return terminal frames.
    return typeof result === 'string' ? result : '';
  }
}
