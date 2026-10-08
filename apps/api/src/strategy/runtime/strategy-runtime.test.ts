import { StrategyRuntime } from './strategy-runtime.js';
import { TypeScriptTransport } from '#infra/runtime/typescript/transport.js';
import type { EngineContext } from '#backtesting/contract.js';
import type { StrategyLanguage } from '@jixie/shared';
import type { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PythonSession } from '#infra/runtime/python/session.js';

function sessionFixture(language: StrategyLanguage, frame: unknown) {
  const session = {
    send: vi.fn(async (_frame: unknown) => {}),
    readValidated: vi.fn(async <Frame>(schema: z.ZodType<Frame>) => schema.parse(frame)),
    close: vi.fn(),
  };
  if (language === 'python') {
    vi.spyOn(PythonSession, 'connect').mockResolvedValue(session as unknown as PythonSession);
  } else {
    vi.spyOn(TypeScriptTransport, 'connect').mockResolvedValue(
      session as unknown as TypeScriptTransport,
    );
  }

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

describe.each(['typescript', 'python'] as const)('%s strategy runtime ownership', (language) => {
  it('passes source and parameter overrides to startup and owns successful shutdown', async () => {
    const session = sessionFixture(language, ready);
    const runtime = await StrategyRuntime.start({
      language,
      code: 'source',
      onUserLog: undefined,
      paramOverrides: { lookback: 7 },
    });
    expect(session.send).toHaveBeenCalledOnce();
    if (language === 'python') {
      expect(session.send).toHaveBeenCalledWith({
        type: 'start',
        runtime_version: 'py-v1',
        code: 'source',
        param_overrides: { lookback: 7 },
      });
    } else {
      expect(session.send).toHaveBeenCalledWith({
        type: 'start',
        userJs: expect.any(String),
        paramOverrides: { lookback: 7 },
        locale: 'zh',
        captureUserLogs: false,
      });
    }
    expect(runtime).toBeInstanceOf(StrategyRuntime);
    expect(runtime).not.toHaveProperty('metrics');
    expect(runtime.metadata.params).toEqual({ lookback: 7 });
    expect(session.close).not.toHaveBeenCalled();
    runtime.close();
    expect(session.send).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('closes the session when startup sending fails', async () => {
    const session = sessionFixture(language, ready);
    session.send.mockRejectedValueOnce(new Error('connection lost'));
    await expect(StrategyRuntime.start({ language, code: 'source' })).rejects.toThrow(
      'connection lost',
    );
    expect(session.readValidated).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
  });

  it.each([
    { type: 'fatal', message: 'initialization failed' },
    { type: 'ready', metadata: { ...ready.metadata, watch: ['AAA', 'AAA'] } },
  ])('closes the session when the bridge rejects startup: $type', async (frame) => {
    const session = sessionFixture(language, frame);
    await expect(StrategyRuntime.start({ language, code: 'source' })).rejects.toThrow();
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('closes synchronously without sending a shutdown frame', async () => {
    const session = sessionFixture(language, ready);
    const runtime = await StrategyRuntime.start({ language, code: 'source' });
    runtime.close();
    runtime.close();
    expect(session.send).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
    await expect(runtime.execute({ context: {} as EngineContext })).rejects.toThrow('closed');
  });
});
