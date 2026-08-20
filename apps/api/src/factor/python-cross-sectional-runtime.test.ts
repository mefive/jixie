import type { FactorBar } from '@jixie/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { compilePythonCrossSectionalFactor } from './python-cross-sectional-runtime.js';

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
  netMain: 30,
  netTotal: 40,
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
    const factor = await compilePythonCrossSectionalFactor(`
from jixie import Factor, FactorBar, CrossSectionalFactorContext

factor = Factor.cross_sectional(name="value momentum", window=3, min_coverage=0.8)

@factor.compute
def compute(bar: FactorBar, ctx: CrossSectionalFactorContext) -> float | None:
    closes = ctx.history(3)
    if bar.pe_ttm is None or len(closes) < 3:
        return None
    return 1 / bar.pe_ttm + closes[-1] / closes[0] - 1
`);
    try {
      expect(factor).toMatchObject({ name: 'value momentum', window: 3, minCoverage: 0.8 });
      await expect(
        factor.computeBatch([
          { bar: BAR, closes: [10, 11, 12], dates: ['1', '2', '3'] },
          { bar: { ...BAR, peTtm: null }, closes: [10, 11, 12], dates: ['1', '2', '3'] },
        ]),
      ).resolves.toEqual([1 / 9 + 0.2, null]);
    } finally {
      factor.dispose();
    }
  });

  it('surfaces only the first repeated compute traceback', async () => {
    enableTestRuntime();
    const logs: string[] = [];
    const factor = await compilePythonCrossSectionalFactor(
      `
from jixie import Factor, FactorBar, CrossSectionalFactorContext
factor = Factor.cross_sectional(name="broken")
@factor.compute
def compute(bar: FactorBar, ctx: CrossSectionalFactorContext) -> float | None:
    raise ValueError("boom")
`,
      (_level, text) => logs.push(text),
    );
    try {
      await factor.computeBatch([{ bar: BAR }]);
      await factor.computeBatch([{ bar: BAR }]);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatch(/\[factor-error\].*factor\.py.*ValueError: boom/s);
    } finally {
      factor.dispose();
    }
  });

  it('rejects a mismatched runtime factory before analysis', async () => {
    enableTestRuntime();
    await expect(
      compilePythonCrossSectionalFactor(`
from jixie import Factor
factor = Factor.time_series(name="wrong", inputs=[], target_asset_classes=[], window=2)
@factor.compute
def compute(ctx):
    return 1
`),
    ).rejects.toThrow(/does not match cross_sectional/);
  });
});

function enableTestRuntime(): void {
  if (!process.env.JIXIE_SANDBOX_SOCKET) {
    process.env.JIXIE_PYTHON_LOCAL = '1';
  }
}
