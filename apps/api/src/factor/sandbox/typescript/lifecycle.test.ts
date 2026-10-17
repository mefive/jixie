import { afterEach, describe, expect, it, vi } from 'vitest';
import { TypeScriptTransport } from '#infra/sandbox/typescript/typescript-transport.js';
import { FactorSandbox } from '../factor-sandbox.js';

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
    const sandbox = await FactorSandbox.start(options);
    try {
      expect(sandbox.metadata).toMatchObject({ name: 'stateful', analysisKind: 'cross_sectional' });
      const items = Array.from({ length: 10_000 }, (_, index) => ({
        bar: { close: index } as never,
      }));
      const result = await sandbox.execute({ items });
      expect(result).toEqual(items.map((_, index) => 2 * index + 1));
      await expect(sandbox.execute({ items: [{ bar: { close: 20 } as never }] })).resolves.toEqual([
        10_021,
      ]);
      expect(send.mock.calls.map(([frame]) => frame.type)).toEqual([
        'factor_start',
        'factor_compute_batch',
        'factor_compute_batch',
      ]);
    } finally {
      sandbox.close();
    }
    sandbox.close();
    await expect(sandbox.execute({ items: [] })).rejects.toThrow('closed');
  });

  it('preserves log levels and ordering across initialization and computation', async () => {
    const onUserLog = vi.fn();
    const sandbox = await FactorSandbox.start({
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
      await sandbox.execute({ items: [{ bar: { close: 3 } as never }] });
      expect(onUserLog.mock.calls).toEqual([
        ['info', 'starting'],
        ['warn', 'item 3'],
        ['error', 'detail'],
      ]);
    } finally {
      sandbox.close();
    }
  });

  it('closes a failed startup and preserves its original error', async () => {
    const close = vi.spyOn(TypeScriptTransport.prototype, 'close');
    const onUserLog = vi.fn();
    await expect(
      FactorSandbox.start({
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
    const sandbox = await FactorSandbox.start({
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
      await expect(sandbox.execute({ items })).resolves.toEqual(items.map((_, index) => index));
      expect(onUserLog.mock.calls).toEqual(items.map((_, index) => ['info', `value ${index}`]));
      const frames = await Promise.all(read.mock.results.map((result) => result.value));
      expect(frames.map((frame) => frame.type)).toEqual([
        'factor_ready',
        ...Array.from({ length: 40 }, () => 'log_batch'),
        'factor_values',
      ]);
      await sandbox.execute({ items: [] });
      expect(onUserLog).toHaveBeenCalledTimes(10_000);
    } finally {
      sandbox.close();
    }
  });

  it('flushes point-failure logs before the deduplicated compute error', async () => {
    const onUserLog = vi.fn();
    const sandbox = await FactorSandbox.start({
      ...options,
      onUserLog,
      code: `export default defineFactor({ name: 'failure logs', compute() {
        console.warn('before failure'); throw new Error('point failed');
      } });`,
    });
    try {
      const input = { items: [{ bar: {} as never }] };
      await expect(sandbox.execute(input)).resolves.toEqual([null]);
      await expect(sandbox.execute(input)).resolves.toEqual([null]);
      expect(onUserLog.mock.calls).toEqual([
        ['warn', 'before failure'],
        ['error', '[factor-error] point failed'],
        ['warn', 'before failure'],
      ]);
    } finally {
      sandbox.close();
    }
  });

  it('rejects a terminal result whose length differs from its batch', async () => {
    const sandbox = await FactorSandbox.start({
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
      await expect(sandbox.execute({ items: [{ bar: {} as never }] })).rejects.toThrow(
        'score count',
      );
      await expect(sandbox.execute({ items: [] })).rejects.toThrow('closed');
    } finally {
      sandbox.close();
    }
  });
});
