import { FactorRuntime } from '../factor-runtime.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PythonSession } from '#infra/runtime/python/session.js';

const variants = ['cross_sectional', 'time_series', 'panel'] as const;

function fixture(kind: string) {
  const session = {
    send: vi.fn().mockResolvedValue(undefined),
    readValidated: vi.fn().mockResolvedValue({
      type: 'factor_ready',
      metadata: {
        analysis_kind: kind,
        name: 'fixture',
        window: 2,
        min_coverage: null,
        inputs: kind === 'cross_sectional' ? [] : ['etf.adjustedClose'],
        target_asset_classes: kind === 'cross_sectional' ? [] : ['equity'],
      },
    }),
    close: vi.fn(),
    abort: vi.fn(),
  };
  vi.spyOn(PythonSession, 'connect').mockResolvedValue(session as unknown as PythonSession);
  return session;
}

afterEach(() => vi.restoreAllMocks());

describe.each(variants)('%s lifecycle', (kind) => {
  const start = () =>
    FactorRuntime.start({ language: 'python', analysisKind: kind, code: 'source' });
  it('owns startup and releases once through the shared lifecycle interface', async () => {
    const session = fixture(kind);
    const runtime = await start();
    expect(session.send).toHaveBeenCalledExactlyOnceWith({
      type: 'factor_start',
      runtime_version: 'py-v1',
      analysis_kind: kind,
      code: 'source',
    });
    runtime.close();
    runtime.close();
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('cleans up when startup metadata is rejected', async () => {
    const session = fixture(kind);
    session.readValidated.mockResolvedValue({ type: 'fatal', message: 'bad source' });
    await expect(start()).rejects.toThrow('bad source');
    expect(session.close).toHaveBeenCalledOnce();
  });
});
