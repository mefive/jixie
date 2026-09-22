import type { z } from 'zod';
import type { RuntimeLogFrame, RuntimeLogBatchFrame } from './protocol.js';

export interface SandboxFrame {
  type: string;
  [key: string]: unknown;
}

/** Implementations own frame validation and terminate malformed transports. */
export interface SandboxTransport {
  send(frame: SandboxFrame): Promise<void>;
  readValidated<Frame>(schema: z.ZodType<Frame>, operation: string): Promise<Frame>;
}

type IntermediateFrame = { type: 'log' | 'log_batch' | 'request' | 'error' | 'fatal' };

interface SandboxExchange<Frame extends { type: string }, Result> {
  command: SandboxFrame;
  schema: z.ZodType<Frame>;
  operation: string;
  signal?: AbortSignal;
  onLog?(frame: RuntimeLogFrame): void | Promise<void>;
  onRequest?(frame: Extract<Frame, { type: 'request' }>): Promise<SandboxFrame>;
  result(frame: Exclude<Frame, IntermediateFrame>): Result;
}

const activeTransports = new WeakSet<SandboxTransport>();

/** One command, any intermediate logs/host requests, and exactly one terminal result. */
export async function exchangeSandboxCommand<Frame extends { type: string }, Result>(
  transport: SandboxTransport,
  exchange: SandboxExchange<Frame, Result>,
): Promise<Result> {
  if (activeTransports.has(transport)) {
    throw new Error(
      'Concurrent sandbox exchanges are unsupported; serialize operations at the owner',
    );
  }
  activeTransports.add(transport);
  try {
    exchange.signal?.throwIfAborted();
    await transport.send(exchange.command);
    while (true) {
      exchange.signal?.throwIfAborted();
      const frame = await transport.readValidated(exchange.schema, exchange.operation);
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
          await transport.send(response);
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
    activeTransports.delete(transport);
  }
}
