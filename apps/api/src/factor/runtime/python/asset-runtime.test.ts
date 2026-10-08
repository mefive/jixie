import { FactorRuntime } from '../factor-runtime.js';
import { afterEach, describe, expect, it } from 'vitest';

describe('Python asset Factor runtime', () => {
  afterEach(() => {
    delete process.env.JIXIE_PYTHON_LOCAL;
  });

  it('computes a time-series score with declared inputs and lag', async () => {
    enableTestRuntime();
    const factor = await FactorRuntime.start({
      language: 'python',
      analysisKind: 'time_series',
      code: `
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
`,
    });
    try {
      expect(factor.metadata).toMatchObject({
        analysisKind: 'time_series',
        window: 3,
        inputs: ['etf.adjustedClose'],
      });
      const values = await factor.execute({
        fields: { 'etf.adjustedClose': [10, 11, 12, 9] },
        indexes: [2, 3],
      });
      expect(values[0]).toBeCloseTo(0.2, 12);
      expect(values[1]).toBeCloseTo(9 / 11 - 1, 12);
    } finally {
      factor.close();
    }
  });

  it.each(['time_series', 'panel'] as const)(
    'normalizes invalid %s point results and continues after the first traceback',
    async (analysisKind) => {
      enableTestRuntime();
      const logs: string[] = [];
      const factor = await FactorRuntime.start({
        language: 'python',
        analysisKind,
        onUserLog: (_level, text) => logs.push(text),
        code: `
from jixie import Factor
factor = Factor.${analysisKind}(name="point results", inputs=["etf.adjustedClose"], target_asset_classes=["equity"], window=2)
@factor.compute
def compute(ctx):
    value = ctx.value("etf.adjustedClose")
    match value:
        case 1:
            return True
        case 2:
            return float("nan")
        case 3:
            return float("inf")
        case 4:
            return "invalid"
        case 5:
            raise ValueError("point failure fixture")
        case _:
            return value
`,
      });
      try {
        const input = {
          fields: { 'etf.adjustedClose': [1, 2, 3, 4, 5, 6] },
          indexes: [0, 1, 2, 3, 4, 5],
        };
        await expect(factor.execute(input)).resolves.toEqual([null, null, null, null, null, 6]);
        await expect(factor.execute(input)).resolves.toEqual([null, null, null, null, null, 6]);
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatch(/\[factor-error\].*ValueError: point failure fixture/s);
      } finally {
        factor.close();
      }
    },
  );

  it('uses the same execution contract for panel Factors', async () => {
    enableTestRuntime();
    const factor = await FactorRuntime.start({
      language: 'python',
      analysisKind: 'panel',
      code: `
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
`,
    });
    try {
      expect(factor.metadata.analysisKind).toBe('panel');
      await expect(
        factor.execute({ fields: { 'etf.adjustedClose': [10, 12, 11] }, indexes: [1, 2] }),
      ).resolves.toEqual([2, -1]);
    } finally {
      factor.close();
    }
  });
});

function enableTestRuntime(): void {
  if (!process.env.JIXIE_SANDBOX_SOCKET) {
    process.env.JIXIE_PYTHON_LOCAL = '1';
  }
}
