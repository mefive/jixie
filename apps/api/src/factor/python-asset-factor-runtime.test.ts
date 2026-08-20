import { afterEach, describe, expect, it } from 'vitest';
import {
  compilePythonPanelFactor,
  compilePythonTimeSeriesFactor,
} from './python-asset-factor-runtime.js';

describe('Python asset Factor runtime', () => {
  afterEach(() => {
    delete process.env.JIXIE_PYTHON_LOCAL;
  });

  it('computes a time-series score with declared inputs and lag', async () => {
    enableTestRuntime();
    const factor = await compilePythonTimeSeriesFactor(`
from jixie import Factor, AssetFactorContext
factor = Factor.time_series(
    name="ETF momentum",
    inputs=["etf.adjustedClose"],
    target_asset_classes=["equity"],
    window=3,
)
@factor.compute
def compute(ctx: AssetFactorContext) -> float | None:
    current = ctx.value("etf.adjustedClose")
    previous = ctx.lag("etf.adjustedClose", 2)
    return None if current is None or previous is None else current / previous - 1
`);
    try {
      expect(factor).toMatchObject({
        analysisKind: 'time_series',
        window: 3,
        inputs: ['etf.adjustedClose'],
      });
      const values = await factor.computeSeries({ 'etf.adjustedClose': [10, 11, 12, 9] }, [2, 3]);
      expect(values[0]).toBeCloseTo(0.2, 12);
      expect(values[1]).toBeCloseTo(9 / 11 - 1, 12);
    } finally {
      factor.dispose();
    }
  });

  it('uses the same execution contract for panel Factors', async () => {
    enableTestRuntime();
    const factor = await compilePythonPanelFactor(`
from jixie import Factor, AssetFactorContext
factor = Factor.panel(
    name="Panel trend",
    inputs=["etf.adjustedClose"],
    target_asset_classes=["equity"],
    window=2,
)
@factor.compute
def compute(ctx: AssetFactorContext) -> float | None:
    value = ctx.value("etf.adjustedClose")
    lagged = ctx.lag("etf.adjustedClose", 1)
    return None if value is None or lagged is None else value - lagged
`);
    try {
      expect(factor.analysisKind).toBe('panel');
      await expect(
        factor.computeSeries({ 'etf.adjustedClose': [10, 12, 11] }, [1, 2]),
      ).resolves.toEqual([2, -1]);
    } finally {
      factor.dispose();
    }
  });
});

function enableTestRuntime(): void {
  if (!process.env.JIXIE_SANDBOX_SOCKET) {
    process.env.JIXIE_PYTHON_LOCAL = '1';
  }
}
