import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { FactorLanguage, FactorBar } from '@jixie/shared';
import type { z } from 'zod';
import { FactorRuntime } from './factor-runtime.js';
import { PythonSession } from '#infra/runtime/python/session.js';
import { TypeScriptTransport } from '#infra/runtime/typescript/transport.js';
import type {
  AssetFactorExecutionInput,
  CrossSectionalFactorExecutionInput,
  ExecutableFactorKind,
} from './contract.js';

const bar: FactorBar = {
  code: 'ETF',
  pe: null,
  peTtm: 3,
  pb: null,
  ps: null,
  psTtm: null,
  dvRatio: null,
  dvTtm: null,
  totalMv: null,
  circMv: null,
  turnoverRate: null,
  netMain: null,
  netTotal: null,
  roe: null,
  roa: null,
  grossprofitMargin: null,
  debtToAssets: null,
};

function ready(language: FactorLanguage, analysisKind: ExecutableFactorKind) {
  if (language === 'python') {
    return {
      type: 'factor_ready',
      metadata: {
        name: 'fixture',
        analysis_kind: analysisKind,
        window: analysisKind === 'cross_sectional' ? null : 20,
        min_coverage: null,
        inputs: analysisKind === 'cross_sectional' ? [] : ['etf.adjustedClose'],
        target_asset_classes: analysisKind === 'cross_sectional' ? [] : ['equity'],
      },
    };
  }

  return {
    type: 'factor_ready',
    metadata:
      analysisKind === 'cross_sectional'
        ? { name: 'fixture', analysisKind, window: null, minCoverage: null }
        : {
            name: 'fixture',
            analysisKind,
            window: 20,
            version: 2,
            outputScope: 'asset',
            frequency: 'daily',
            inputs: ['etf.adjustedClose'],
            targetAssetClasses: ['equity'],
          },
  };
}

function sessionFixture(language: FactorLanguage, ...frames: unknown[]) {
  const session = {
    send: vi.fn(async (_frame: unknown) => {}),
    readValidated: vi.fn(async <Frame>(schema: z.ZodType<Frame>) => schema.parse(frames.shift())),
    close: vi.fn(),
    abort: vi.fn(),
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

afterEach(() => vi.restoreAllMocks());

describe.each(['typescript', 'python'] as const)('%s factor runtime ownership', (language) => {
  it.each(['cross_sectional', 'time_series', 'panel'] as const)(
    'owns one %s session and passes startup source without changing its protocol',
    async (analysisKind) => {
      const session = sessionFixture(language, ready(language, analysisKind));
      const runtime = await FactorRuntime.start({ language, analysisKind, code: 'source' });
      expect(runtime).toBeInstanceOf(FactorRuntime);
      expect(runtime.metadata).toMatchObject({ name: 'fixture', analysisKind });
      expect(runtime).not.toHaveProperty('metrics');
      expect(session.send).toHaveBeenCalledExactlyOnceWith(
        language === 'python'
          ? {
              type: 'factor_start',
              runtime_version: 'py-v1',
              analysis_kind: analysisKind,
              code: 'source',
            }
          : { type: 'factor_start', analysis_kind: analysisKind, userJs: expect.any(String) },
      );
      expect(session.close).not.toHaveBeenCalled();

      runtime.close();
      runtime.close();
      expect(session.close).toHaveBeenCalledOnce();
      expect(runtime.metadata).toMatchObject({ name: 'fixture', analysisKind });
      expect(session.send).toHaveBeenCalledOnce();
    },
  );

  it('closes a session when startup sending fails', async () => {
    const session = sessionFixture(language, ready(language, 'cross_sectional'));
    session.send.mockRejectedValueOnce(new Error('connection lost'));
    await expect(
      FactorRuntime.start({ language, analysisKind: 'cross_sectional', code: 'source' }),
    ).rejects.toThrow('connection lost');
    expect(session.readValidated).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('closes a session when metadata declares the wrong kind', async () => {
    const session = sessionFixture(language, ready(language, 'panel'));
    await expect(
      FactorRuntime.start({ language, analysisKind: 'time_series', code: 'source' }),
    ).rejects.toThrow();
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('keeps cross-sectional inputs separate and maps Python history fields', async () => {
    const session = sessionFixture(language, ready(language, 'cross_sectional'), {
      type: 'factor_values',
      values: [3],
      first_error: null,
    });
    const runtime = await FactorRuntime.start({
      language,
      analysisKind: 'cross_sectional',
      code: 'source',
    });
    expectTypeOf(runtime.execute).parameter(0).toEqualTypeOf<CrossSectionalFactorExecutionInput>();
    const input: CrossSectionalFactorExecutionInput = {
      items: [{ bar, closes: [1, 2], dates: ['20260101', '20260102'] }],
    };
    try {
      await expect(runtime.execute(input)).resolves.toEqual([3]);
      const command = session.send.mock.calls[1][0];
      expect(command).toMatchObject(
        language === 'python'
          ? {
              type: 'factor_compute_batch',
              items: [
                {
                  bar: { code: 'ETF', pe_ttm: 3 },
                  history: { close: [1, 2], date: ['20260101', '20260102'] },
                },
              ],
            }
          : { type: 'factor_compute_batch', ...input },
      );
    } finally {
      runtime.close();
    }
  });

  it('preserves typed asset inputs and panel metadata', async () => {
    const session = sessionFixture(language, ready(language, 'panel'), {
      type: 'factor_values',
      values: [2],
      first_error: null,
    });
    const runtime = await FactorRuntime.start({ language, analysisKind: 'panel', code: 'source' });
    expectTypeOf(runtime.execute).parameter(0).toEqualTypeOf<AssetFactorExecutionInput>();
    expectTypeOf(runtime.metadata.analysisKind).toEqualTypeOf<'panel'>();
    const input = { fields: { 'etf.adjustedClose': [1, 2] }, indexes: [1] };
    try {
      await expect(runtime.execute(input)).resolves.toEqual([2]);
      expect(session.send).toHaveBeenLastCalledWith({ type: 'factor_compute_series', ...input });
    } finally {
      runtime.close();
    }
  });

  it('reports the first compute error once per instance across consecutive batches', async () => {
    const failedPoint = { type: 'factor_values', values: [null], first_error: 'point failed' };
    sessionFixture(language, ready(language, 'cross_sectional'), failedPoint, failedPoint);
    const onUserLog = vi.fn();
    const options = {
      language,
      analysisKind: 'cross_sectional' as const,
      code: 'source',
      onUserLog,
    };
    const runtime = await FactorRuntime.start(options);
    try {
      await expect(runtime.execute({ items: [{ bar }] })).resolves.toEqual([null]);
      await expect(runtime.execute({ items: [{ bar }] })).resolves.toEqual([null]);
      expect(onUserLog.mock.calls).toEqual([['error', '[factor-error] point failed']]);
    } finally {
      runtime.close();
    }

    sessionFixture(language, ready(language, 'cross_sectional'), failedPoint);
    const replacement = await FactorRuntime.start(options);
    try {
      await expect(replacement.execute({ items: [{ bar }] })).resolves.toEqual([null]);
      expect(onUserLog.mock.calls).toEqual([
        ['error', '[factor-error] point failed'],
        ['error', '[factor-error] point failed'],
      ]);
    } finally {
      replacement.close();
    }
  });

  it('aborts malformed result lengths and preserves language-specific error reporting order', async () => {
    const session = sessionFixture(language, ready(language, 'cross_sectional'), {
      type: 'factor_values',
      values: [],
      first_error: 'point failed',
    });
    const onUserLog = vi.fn();
    const runtime = await FactorRuntime.start({
      language,
      analysisKind: 'cross_sectional',
      code: 'source',
      onUserLog,
    });
    try {
      await expect(runtime.execute({ items: [{ bar }] })).rejects.toThrow(
        language === 'python' ? 'invalid Python Factor result length' : 'score count',
      );
      expect(session.abort).toHaveBeenCalledOnce();
      expect(onUserLog.mock.calls).toEqual(
        language === 'python' ? [['error', '[factor-error] point failed']] : [],
      );
      await expect(runtime.execute({ items: [] })).rejects.toThrow('closed');
    } finally {
      runtime.close();
    }
  });
});
