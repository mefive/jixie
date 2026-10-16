import type { z } from 'zod';
import type { RuntimeLogFrame, RuntimeLogBatchFrame } from './protocol.js';
import type { SandboxBridge, SandboxBridgeInitializationOptions } from './sandbox-bridge.js';
import type { SandboxFrame, SandboxTransport } from './transport.js';

type IntermediateFrame = { type: 'log' | 'log_batch' | 'request' | 'error' | 'fatal' };

export interface SandboxExchange<Frame extends { type: string }, Result> {
  command: SandboxFrame;
  schema: z.ZodType<Frame>;
  operation: string;
  signal?: AbortSignal;
  onLog?(frame: RuntimeLogFrame): void | Promise<void>;
  onRequest?(frame: Extract<Frame, { type: 'request' }>): Promise<SandboxFrame>;
  result(frame: Exclude<Frame, IntermediateFrame>): Result;
}

/** Owns the transport and shares protocol execution across business bridges. */
export abstract class SandboxBridgeBase<
  Input,
  Output,
  Metadata,
  Options = undefined,
  Transport extends SandboxTransport = SandboxTransport,
> implements SandboxBridge<Input, Output, Metadata, Options> {
  private static readonly activeTransports = new WeakSet<SandboxTransport>();

  constructor(protected readonly transport: Transport) {}

  abstract initialize(options?: SandboxBridgeInitializationOptions): Promise<Metadata>;

  abstract execute(input: Input, options?: Options): Promise<Output>;

  get isClosed(): boolean {
    return this.transport.isClosed;
  }

  close(): void {
    this.transport.close();
  }

  abort(error: Error): void {
    this.transport.abort(error);
  }

  /** Keep terminal processing inside the transport guard, including synchronous business callbacks. */
  protected async exchange<Frame extends { type: string }, Result>(
    exchange: SandboxExchange<Frame, Result>,
  ): Promise<Result> {
    if (SandboxBridgeBase.activeTransports.has(this.transport)) {
      throw new Error(
        'Concurrent sandbox exchanges are unsupported; serialize operations at the owner',
      );
    }
    SandboxBridgeBase.activeTransports.add(this.transport);

    try {
      exchange.signal?.throwIfAborted();
      await this.transport.send(exchange.command);

      while (true) {
        exchange.signal?.throwIfAborted();
        const frame = await this.transport.readValidated(exchange.schema, exchange.operation);
        exchange.signal?.throwIfAborted();

        // The schema validates the union; these casts narrow its generic members by discriminator.
        switch (frame.type) {
          case 'log':
            await exchange.onLog?.(frame as Frame & RuntimeLogFrame);
            break;
          case 'log_batch':
            for (const entry of (frame as Frame & RuntimeLogBatchFrame).entries) {
              exchange.signal?.throwIfAborted();
              await exchange.onLog?.({ type: 'log', ...entry });
            }
            break;
          case 'request': {
            if (!exchange.onRequest) {
              throw new Error(`Unexpected host request while ${exchange.operation}`);
            }
            const response = await exchange.onRequest(frame as Extract<Frame, { type: 'request' }>);
            exchange.signal?.throwIfAborted();
            await this.transport.send(response);
            break;
          }
          case 'error':
          case 'fatal':
            throw new Error(
              String(
                (frame as { message?: unknown }).message ??
                  `Sandbox failed while ${exchange.operation}`,
              ),
            );
          default:
            return exchange.result(frame as Exclude<Frame, IntermediateFrame>);
        }
      }
    } finally {
      SandboxBridgeBase.activeTransports.delete(this.transport);
    }
  }
}
