import { FactorSandbox } from '../factor-sandbox.js';
import type { FactorBar } from '@jixie/shared';
import { afterEach, describe, expect, it } from 'vitest';

const BAR: FactorBar = {
  code: '000001.SZ',
  pe: 10,
  peTtm: 9,
  pb: 1.2,
  ps: 2,
  psTtm: 1.8,
  dvRatio: 1,
  dvTtm: 1.1,
  totalMv: 1_000,
  circMv: 800,
  turnoverRate: 2,
  roe: 12,
  roa: 6,
  grossprofitMargin: 20,
  debtToAssets: 40,
};

describe('Python cross-sectional Factor runtime', () => {
  afterEach(() => {
    delete process.env.JIXIE_PYTHON_LOCAL;
    delete process.env.JIXIE_PYTHON_CODE_TIMEOUT_SECONDS;
  });

  it('computes typed bars and history with py-v1 metadata', async () => {
    enableTestRuntime();
    const factor = await FactorSandbox.start({
      language: 'python',
      analysisKind: 'cross_sectional',
      code: `
from jixie import Factor, FactorBar, CrossSectionalFactorContext

factor = Factor.cross_sectional(name="value momentum", window=3, min_coverage=0.8)

@factor.compute
def compute(bar: FactorBar, ctx: CrossSectionalFactorContext) -> float | None:
    closes = ctx.history(3)
    if bar.pe_ttm is None or len(closes) < 3:
        return None
    return 1 / bar.pe_ttm + closes[-1] / closes[0] - 1
`,
    });
    try {
      expect(factor.metadata).toMatchObject({
        name: 'value momentum',
        window: 3,
        minCoverage: 0.8,
      });
      await expect(
        factor.execute({
          items: [
            { bar: BAR, closes: [10, 11, 12], dates: ['1', '2', '3'] },
            { bar: { ...BAR, peTtm: null }, closes: [10, 11, 12], dates: ['1', '2', '3'] },
          ],
        }),
      ).resolves.toEqual([1 / 9 + 0.2, null]);
    } finally {
      factor.close();
    }
  });

  it('surfaces only the first repeated compute traceback', async () => {
    enableTestRuntime();
    const logs: string[] = [];
    const factor = await FactorSandbox.start({
      language: 'python',
      analysisKind: 'cross_sectional',
      code: `
from jixie import Factor, FactorBar, CrossSectionalFactorContext
factor = Factor.cross_sectional(name="broken")
@factor.compute
def compute(bar: FactorBar, ctx: CrossSectionalFactorContext) -> float | None:
    raise ValueError("boom")
`,
      onUserLog: (_level, text) => logs.push(text),
    });
    try {
      await factor.execute({ items: [{ bar: BAR }] });
      await factor.execute({ items: [{ bar: BAR }] });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatch(/\[factor-error\].*factor\.py.*ValueError: boom/s);
    } finally {
      factor.close();
    }
  });

  it('rejects a mismatched runtime factory before analysis', async () => {
    enableTestRuntime();
    await expect(
      FactorSandbox.start({
        language: 'python',
        analysisKind: 'cross_sectional',
        code: `
from jixie import Factor
factor = Factor.time_series(name="wrong", inputs=[], target_asset_classes=[], window=2)
@factor.compute
def compute(ctx):
    return 1
`,
      }),
    ).rejects.toThrow(/does not match cross_sectional/);
  });
});

function enableTestRuntime(): void {
  if (!process.env.JIXIE_SANDBOX_SOCKET) {
    process.env.JIXIE_PYTHON_LOCAL = '1';
  }
}

it.each(['net_main', 'net_total'])(
  'rejects retired Python FactorBar.%s rather than returning nulls',
  async (field) => {
    enableTestRuntime();
    const factor = await FactorSandbox.start({
      language: 'python',
      analysisKind: 'cross_sectional',
      code: `
from jixie import Factor
factor = Factor.cross_sectional(name="retired field")
@factor.compute
def compute(bar, ctx):
    return bar.${field}
`,
    });
    try {
      await expect(factor.execute({ items: [{ bar: BAR }] })).rejects.toThrow(field);
    } finally {
      factor.close();
      delete process.env.JIXIE_PYTHON_LOCAL;
    }
  },
);
