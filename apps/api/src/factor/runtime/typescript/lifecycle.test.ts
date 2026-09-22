import { afterEach, describe, expect, it, vi } from 'vitest';
import { TypeScriptTransport } from '#infra/runtime/typescript/transport.js';
import { FactorRuntime } from '../factor-runtime.js';

const options = {
  language: 'typescript' as const,
  analysisKind: 'cross_sectional' as const,
  code: `let count = 0; export default defineFactor({
    name: 'stateful', compute(bar) { return ++count + bar.close; }
  });`,
};

afterEach(() => vi.restoreAllMocks());

describe('TypeScript Factor lifecycle and command exchange', () => {
  it('uses one startup and one command per batch, preserving state and result order', async () => {
    const send = vi.spyOn(TypeScriptTransport.prototype, 'send');
    const runtime = await FactorRuntime.start(options);
    try {
      expect(runtime.metadata).toMatchObject({ name: 'stateful', analysisKind: 'cross_sectional' });
      const items = Array.from({ length: 10_000 }, (_, index) => ({
        bar: { close: index } as never,
      }));
      const result = await runtime.execute({ items });
      expect(result).toEqual(items.map((_, index) => 2 * index + 1));
      await expect(runtime.execute({ items: [{ bar: { close: 20 } as never }] })).resolves.toEqual([
        10_021,
      ]);
      expect(send.mock.calls.map(([frame]) => frame.type)).toEqual([
        'factor_start',
        'factor_compute_batch',
        'factor_compute_batch',
      ]);
    } finally {
      runtime.close();
    }
    runtime.close();
    await expect(runtime.execute({ items: [] })).rejects.toThrow('closed');
  });

  it('preserves log levels and ordering across initialization and computation', async () => {
    const onUserLog = vi.fn();
    const runtime = await FactorRuntime.start({
      ...options,
      onUserLog,
      code: `
      console.info('starting');
      export default defineFactor({ name: 'logs', compute(bar) {
        console.warn('item', bar.close); console.error('detail'); return bar.close;
      }});
    `,
    });
    try {
      await runtime.execute({ items: [{ bar: { close: 3 } as never }] });
      expect(onUserLog.mock.calls).toEqual([
        ['info', 'starting'],
        ['warn', 'item 3'],
        ['error', 'detail'],
      ]);
    } finally {
      runtime.close();
    }
  });

  it('closes a failed startup and preserves its original error', async () => {
    const close = vi.spyOn(TypeScriptTransport.prototype, 'close');
    const onUserLog = vi.fn();
    await expect(
      FactorRuntime.start({
        ...options,
        onUserLog,
        code: "console.error('startup detail'); throw new Error('startup failed')",
      }),
    ).rejects.toThrow('startup failed');
    expect(onUserLog).toHaveBeenCalledExactlyOnceWith('error', 'startup detail');
    expect(close).toHaveBeenCalledOnce();
  });

  it('delivers ten thousand logs through forty batches without losing the final tail', async () => {
    const read = vi.spyOn(TypeScriptTransport.prototype, 'readValidated');
    const onUserLog = vi.fn();
    const runtime = await FactorRuntime.start({
      ...options,
      onUserLog,
      code: `export default defineFactor({ name: 'batched logs', compute(bar) {
        console.info('value', bar.peTtm); return bar.peTtm;
      } });`,
    });
    try {
      const items = Array.from({ length: 10_000 }, (_, index) => ({
        bar: { peTtm: index } as never,
      }));
      await expect(runtime.execute({ items })).resolves.toEqual(items.map((_, index) => index));
      expect(onUserLog.mock.calls).toEqual(items.map((_, index) => ['info', `value ${index}`]));
      const frames = await Promise.all(read.mock.results.map((result) => result.value));
      expect(frames.map((frame) => frame.type)).toEqual([
        'factor_ready',
        ...Array.from({ length: 40 }, () => 'log_batch'),
        'factor_values',
      ]);
      await runtime.execute({ items: [] });
      expect(onUserLog).toHaveBeenCalledTimes(10_000);
    } finally {
      runtime.close();
    }
  });

  it('flushes point-failure logs before the deduplicated compute error', async () => {
    const onUserLog = vi.fn();
    const runtime = await FactorRuntime.start({
      ...options,
      onUserLog,
      code: `export default defineFactor({ name: 'failure logs', compute() {
        console.warn('before failure'); throw new Error('point failed');
      } });`,
    });
    try {
      const input = { items: [{ bar: {} as never }] };
      await expect(runtime.execute(input)).resolves.toEqual([null]);
      await expect(runtime.execute(input)).resolves.toEqual([null]);
      expect(onUserLog.mock.calls).toEqual([
        ['warn', 'before failure'],
        ['error', '[factor-error] point failed'],
        ['warn', 'before failure'],
      ]);
    } finally {
      runtime.close();
    }
  });

  it('rejects a terminal result whose length differs from its batch', async () => {
    const runtime = await FactorRuntime.start({
      ...options,
      code: `
      const original = globalThis.__receiveCommand;
      globalThis.__receiveCommand = (json) => {
        const command = JSON.parse(json);
        return command.type === 'factor_compute_batch'
          ? JSON.stringify({ type: 'factor_values', values: [], first_error: null })
          : original(json);
      };
      export default defineFactor({ name: 'invalid result', compute() { return 1; } });
    `,
    });
    try {
      await expect(runtime.execute({ items: [{ bar: {} as never }] })).rejects.toThrow(
        'score count',
      );
      await expect(runtime.execute({ items: [] })).rejects.toThrow('closed');
    } finally {
      runtime.close();
    }
  });
});
