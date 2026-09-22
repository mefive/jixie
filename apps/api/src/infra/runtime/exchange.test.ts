import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { exchangeSandboxCommand, type SandboxTransport } from './exchange.js';
import {
  runtimeErrorFrameSchema,
  runtimeLogFrameSchema,
  runtimeLogBatchFrameSchema,
} from './protocol.js';

const request = { type: 'request', id: 7 } as const;
const completed = { type: 'completed', value: 42 } as const;
const command = { type: 'execute' };
const schema = z.union([
  runtimeLogFrameSchema,
  runtimeLogBatchFrameSchema,
  runtimeErrorFrameSchema,
  z.strictObject({ type: z.literal('request'), id: z.number() }),
  z.strictObject({ type: z.literal('completed'), value: z.number() }),
]);
const options = {
  command,
  schema,
  operation: 'running a fixture',
  result: (frame: { type: 'completed'; value: number }) => frame.value,
};

function fixture(frames: unknown[]) {
  const send = vi.fn(async (_frame: unknown) => {});
  const read = vi.fn(async (): Promise<unknown> => frames.shift());
  const transport: SandboxTransport = {
    send,
    readValidated: async (frameSchema) => frameSchema.parse(await read()),
  };
  return { ...transport, send, read };
}

describe('sandbox command exchanges', () => {
  it('delivers mixed single and batched logs in order before requests and the terminal result', async () => {
    const transport = fixture([
      { type: 'log', level: 'info', text: 'first' },
      {
        type: 'log_batch',
        entries: [
          { level: 'warning', text: 'second' },
          { level: 'error', text: 'third' },
        ],
      },
      request,
      completed,
    ]);
    const events: string[] = [];
    await exchangeSandboxCommand(transport, {
      ...options,
      onLog: async (frame) => {
        await Promise.resolve();
        events.push(`${frame.level}:${frame.text}`);
      },
      onRequest: async () => {
        events.push('request');
        return { type: 'response', id: request.id, result: {} };
      },
      result: (frame) => {
        events.push('completed');
        return frame.value;
      },
    });
    expect(events).toEqual(['info:first', 'warning:second', 'error:third', 'request', 'completed']);
  });

  it('propagates a batched log sink failure without consuming later messages', async () => {
    const transport = fixture([
      { type: 'log_batch', entries: [{ level: 'info', text: 'first' }] },
      completed,
    ]);
    const failure = new Error('log sink unavailable');
    await expect(
      exchangeSandboxCommand(transport, {
        ...options,
        onLog: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(transport.read).toHaveBeenCalledOnce();
  });

  it('stops a batch when its caller cancels during log delivery', async () => {
    const transport = fixture([
      {
        type: 'log_batch',
        entries: [
          { level: 'info', text: 'first' },
          { level: 'info', text: 'second' },
        ],
      },
      completed,
    ]);
    const controller = new AbortController();
    const onLog = vi.fn(() => controller.abort());
    await expect(
      exchangeSandboxCommand(transport, { ...options, signal: controller.signal, onLog }),
    ).rejects.toThrow();
    expect(onLog).toHaveBeenCalledExactlyOnceWith({ type: 'log', level: 'info', text: 'first' });
    expect(transport.read).toHaveBeenCalledOnce();
  });

  it('sends preloaded input and consumes logs before the result without a host request', async () => {
    const transport = fixture([{ type: 'log', level: 'info', text: 'computing' }, completed]);
    const onLog = vi.fn();
    const input = { type: 'execute', items: [{ history: [1, 2, 3] }] };
    expect(await exchangeSandboxCommand(transport, { ...options, command: input, onLog })).toBe(42);
    expect(transport.send).toHaveBeenCalledExactlyOnceWith(input);
    expect(onLog).toHaveBeenCalledExactlyOnceWith({
      type: 'log',
      level: 'info',
      text: 'computing',
    });
  });

  it('waits for host processing and evidence before sending a response and reading the result', async () => {
    const events: string[] = [];
    const transport = fixture([
      request,
      { type: 'log', level: 'info', text: 'resumed' },
      completed,
    ]);
    transport.send.mockImplementation(async (frame) => {
      events.push((frame as { type: string }).type);
    });
    const response = { type: 'response', id: 7, result: { rows: [1, 2] } };
    expect(
      await exchangeSandboxCommand(transport, {
        ...options,
        onRequest: async (frame) => {
          expect(frame).toEqual(request);
          events.push('load');
          await Promise.resolve();
          events.push('capture');
          return response;
        },
        onLog: () => {
          events.push('log');
        },
        result: (frame) => {
          events.push('completed');
          return frame.value;
        },
      }),
    ).toBe(42);
    expect(events).toEqual(['execute', 'load', 'capture', 'response', 'log', 'completed']);
    expect(transport.send).toHaveBeenNthCalledWith(2, response);
  });

  it('does not send an error response or keep reading after a host evidence failure', async () => {
    const transport = fixture([request, completed]);
    const failure = new Error('evidence unavailable');
    await expect(
      exchangeSandboxCommand(transport, {
        ...options,
        onRequest: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(transport.send).toHaveBeenCalledExactlyOnceWith(command);
    expect(transport.read).toHaveBeenCalledOnce();
  });

  it('propagates a response send failure without attempting to send a second response', async () => {
    const transport = fixture([request, completed]);
    const failure = new Error('connection lost');
    transport.send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
    await expect(
      exchangeSandboxCommand(transport, {
        ...options,
        onRequest: async () => ({ type: 'response', id: 7, result: {} }),
      }),
    ).rejects.toBe(failure);
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(transport.read).toHaveBeenCalledOnce();
  });

  it('stops response delivery when cancelled during the host request', async () => {
    const transport = fixture([request, completed]);
    const controller = new AbortController();
    await expect(
      exchangeSandboxCommand(transport, {
        ...options,
        signal: controller.signal,
        onRequest: async () => {
          controller.abort();
          return { type: 'response', id: 7, result: {} };
        },
      }),
    ).rejects.toThrow();
    expect(transport.send).toHaveBeenCalledExactlyOnceWith(command);
    expect(transport.read).toHaveBeenCalledOnce();
  });

  it('rejects overlapping readers without adding another operation queue', async () => {
    const transport = fixture([]);
    let complete!: (frame: typeof completed) => void;
    let enter!: () => void;
    const reading = new Promise<void>((resolve) => {
      enter = resolve;
    });
    transport.read.mockImplementationOnce(() => {
      enter();
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const first = exchangeSandboxCommand(transport, options);
    await reading;
    await expect(exchangeSandboxCommand(transport, options)).rejects.toThrow('Concurrent');
    expect(transport.send).toHaveBeenCalledOnce();
    complete(completed);
    await expect(first).resolves.toBe(42);
    transport.read.mockResolvedValueOnce(completed);
    await expect(exchangeSandboxCommand(transport, options)).resolves.toBe(42);
  });

  it.each(['error', 'fatal'])('propagates %s and releases the exchange guard', async (type) => {
    const transport = fixture([{ type, message: 'user failure' }, completed]);
    await expect(exchangeSandboxCommand(transport, options)).rejects.toThrow('user failure');
    await expect(exchangeSandboxCommand(transport, options)).resolves.toBe(42);
  });

  it('does not silently consume a request without a handler', async () => {
    const transport = fixture([request, completed]);
    await expect(exchangeSandboxCommand(transport, options)).rejects.toThrow(
      'Unexpected host request',
    );
    expect(transport.read).toHaveBeenCalledOnce();
  });
});
