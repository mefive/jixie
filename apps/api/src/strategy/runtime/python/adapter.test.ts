import { StrategyRuntime } from '../strategy-runtime.js';
import type { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PythonSession } from '#infra/runtime/python/session.js';

function sessionFixture(frame: unknown) {
  const session = {
    send: vi.fn(async (_frame: unknown) => {}),
    readValidated: vi.fn(async <Frame>(schema: z.ZodType<Frame>) => schema.parse(frame)),
    close: vi.fn(),
  };
  vi.spyOn(PythonSession, 'connect').mockResolvedValue(session as unknown as PythonSession);
  return session;
}

const ready = {
  type: 'ready',
  metadata: {
    name: 'fixture',
    params: { lookback: 7 },
    factors: [],
    watch: [],
    futures: [],
    accounts: null,
  },
};

afterEach(() => vi.restoreAllMocks());

describe('Python strategy transport adapter', () => {
  it('passes source and parameter overrides to startup and owns successful shutdown', async () => {
    const session = sessionFixture(ready);
    const runtime = await StrategyRuntime.start({
      language: 'python',
      code: 'source',
      onUserLog: undefined,
      paramOverrides: { lookback: 7 },
    });
    expect(session.send).toHaveBeenCalledExactlyOnceWith({
      type: 'start',
      runtime_version: 'py-v1',
      code: 'source',
      param_overrides: { lookback: 7 },
    });
    expect(runtime.metadata.params).toEqual({ lookback: 7 });
    expect(session.close).not.toHaveBeenCalled();
    runtime.close();
    expect(session.send).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('closes the session when startup sending fails', async () => {
    const session = sessionFixture(ready);
    session.send.mockRejectedValueOnce(new Error('connection lost'));
    await expect(StrategyRuntime.start({ language: 'python', code: 'source' })).rejects.toThrow(
      'connection lost',
    );
    expect(session.readValidated).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
  });

  it.each([
    { type: 'fatal', message: 'initialization failed' },
    { type: 'ready', metadata: { ...ready.metadata, watch: ['AAA', 'AAA'] } },
  ])('closes the session when the bridge rejects startup: $type', async (frame) => {
    const session = sessionFixture(frame);
    await expect(StrategyRuntime.start({ language: 'python', code: 'source' })).rejects.toThrow();
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('closes synchronously without sending a shutdown frame', async () => {
    const session = sessionFixture(ready);
    const runtime = await StrategyRuntime.start({ language: 'python', code: 'source' });
    runtime.close();
    runtime.close();
    expect(session.send).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
  });
});
