import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { exchangeSandboxCommand } from '../exchange.js';
import { TypeScriptTransport } from './transport.js';

const schema = z.union([
  z.object({ type: z.literal('completed'), value: z.number() }),
  z.object({ type: z.literal('request'), id: z.number() }),
]);
const options = { description: 'transport fixture', memoryMb: 32, commandTimeoutMs: () => 1000 };

describe('shared TypeScript transport', () => {
  it('delivers a response while the original command is awaiting host data', async () => {
    const transport = await TypeScriptTransport.connect({
      ...options,
      bundle: `
      let complete;
      globalThis.__receiveCommand = (json) => {
        const frame = JSON.parse(json);
        if (frame.type === 'response') { complete(JSON.stringify({ type: 'completed', value: frame.result })); return; }
        return new Promise((resolve) => {
          complete = resolve;
          __hostEmit.applySync(undefined, [JSON.stringify({ type: 'request', id: 1 })]);
        });
      };
    `,
    });
    try {
      await expect(
        exchangeSandboxCommand(transport, {
          command: { type: 'compute' },
          schema,
          operation: 'fixture',
          onRequest: (frame) => Promise.resolve({ type: 'response', id: frame.id, result: 42 }),
          result: (frame) => frame.value,
        }),
      ).resolves.toBe(42);
      expect(transport.metrics.sentFrames).toBe(2);
      expect(transport.metrics.receivedFrames).toBe(2);
    } finally {
      transport.close();
    }
  });

  it('rejects pending readers on close and discards buffered results', async () => {
    const transport = await TypeScriptTransport.connect({ ...options, bundle: '' });
    const pending = transport.readValidated(schema, 'fixture');
    const failure = expect(pending).rejects.toThrow('closed');
    transport.close();
    transport.close();
    await failure;
    await expect(transport.readValidated(schema, 'fixture')).rejects.toThrow('closed');
    await expect(transport.send({ type: 'compute' })).rejects.toThrow('closed');
  });

  it('rejects malformed terminal frames and closes the isolate', async () => {
    const transport = await TypeScriptTransport.connect({
      ...options,
      bundle: `
      globalThis.__receiveCommand = () => JSON.stringify({ type: 'completed', value: 'wrong' });
    `,
    });
    try {
      await transport.send({ type: 'compute' });
      await expect(transport.readValidated(schema, 'fixture')).rejects.toThrow('protocol');
      expect(transport.isClosed).toBe(true);
    } finally {
      transport.close();
    }
  });

  it('enforces the configured command timeout and closes after execution failure', async () => {
    const transport = await TypeScriptTransport.connect({
      ...options,
      commandTimeoutMs: () => 20,
      bundle: `
      globalThis.__receiveCommand = () => { while (true) {} };
    `,
    });
    try {
      await transport.send({ type: 'compute' });
      await expect(transport.readValidated(schema, 'fixture')).rejects.toThrow(/timed out/);
      expect(transport.isClosed).toBe(true);
    } finally {
      transport.close();
    }
  });

  it('keeps synchronous host access unavailable unless explicitly enabled', async () => {
    const transport = await TypeScriptTransport.connect({
      ...options,
      bundle: `
      globalThis.__receiveCommand = () => JSON.stringify({ type: 'completed', value: typeof __hostAccess === 'undefined' ? 1 : 0 });
    `,
    });
    try {
      await transport.send({ type: 'compute' });
      await expect(transport.readValidated(schema, 'fixture')).resolves.toEqual({
        type: 'completed',
        value: 1,
      });
    } finally {
      transport.close();
    }
  });

  it('rejects oversize frames', async () => {
    const transport = await TypeScriptTransport.connect({
      ...options,
      maxFrameBytes: 100,
      bundle: `
      globalThis.__receiveCommand = () => JSON.stringify({ type: 'completed', value: 'x'.repeat(1000) });
    `,
    });
    try {
      await transport.send({ type: 'compute' });
      await expect(transport.readValidated(schema, 'fixture')).rejects.toThrow('frame size');
      expect(transport.isClosed).toBe(true);
    } finally {
      transport.close();
    }
  });
  it('aborts when an emitter exceeds the pending-frame queue budget', async () => {
    const transport = await TypeScriptTransport.connect({
      ...options,
      maxQueuedFrames: 1,
      bundle: `
      globalThis.__receiveCommand = () => {
        for (let index = 0; index < 10; index++) {
          __hostEmit.applySync(undefined, [JSON.stringify({ type: 'request', id: index })]);
        }
        return JSON.stringify({ type: 'completed', value: 1 });
      };
    `,
    });
    const abort = transport.abort.bind(transport);
    const aborted = new Promise<unknown>((resolve) => {
      vi.spyOn(transport, 'abort').mockImplementation((error) => {
        abort(error);
        resolve(error);
      });
    });
    try {
      await transport.send({ type: 'compute' });
      expect(await aborted).toBeInstanceOf(Error);
      await expect(transport.readValidated(schema, 'fixture')).rejects.toThrow('queue limit');
    } finally {
      transport.close();
      vi.restoreAllMocks();
    }
  });

  it('closes an active command waiting for a host response', async () => {
    const transport = await TypeScriptTransport.connect({
      ...options,
      bundle: `
      globalThis.__receiveCommand = () => new Promise(() => {
        __hostEmit.applySync(undefined, [JSON.stringify({ type: 'request', id: 1 })]);
      });
    `,
    });
    try {
      await transport.send({ type: 'compute' });
      await expect(transport.readValidated(schema, 'fixture')).resolves.toEqual({
        type: 'request',
        id: 1,
      });
      const pending = transport.readValidated(schema, 'fixture');
      const rejected = expect(pending).rejects.toThrow('closed');
      transport.close();
      await rejected;
    } finally {
      transport.close();
    }
  });
  it('retains isolate memory enforcement and closes after exceeding its budget', async () => {
    const transport = await TypeScriptTransport.connect({
      ...options,
      memoryMb: 16,
      commandTimeoutMs: () => 5000,
      bundle: `globalThis.__receiveCommand = () => {
        const retained = [];
        while (true) { retained.push(new Array(10000).fill(1)); }
      };`,
    });
    try {
      await transport.send({ type: 'compute' });
      await expect(transport.readValidated(schema, 'fixture')).rejects.toThrow(/memory limit/);
      expect(transport.isClosed).toBe(true);
    } finally {
      transport.close();
    }
  }, 10000);
});
