import { describe, expect, it } from 'vitest';
import { RESEARCH_SDK_CONTRACT_V1 } from '@jixie/shared';
import { normalizeFactorResearchSpec } from '#factor/analysis/spec.js';
import { isRetiredFactorReport } from '#factor/evaluations/report-spec.js';
import { FactorSandbox } from '#factor/sandbox/factor-sandbox.js';
import { loadResearchSeries } from '#research/datasets/series.js';
import { researchCellRunFrameSchema } from '#research/sandbox/host/protocol.js';
import { parseResearchSeriesRuntimeRequest } from '#research/sandbox/host/validation.js';

describe('retired macro, rates, FX and benchmark capabilities', () => {
  it('rejects old host methods and omits their public SDK contracts', () => {
    for (const method of ['yield_curve', 'macro', 'fx']) {
      expect(RESEARCH_SDK_CONTRACT_V1.functions.some((entry) => entry.name === method)).toBe(false);
      expect(() =>
        researchCellRunFrameSchema.parse({
          type: 'request',
          id: 1,
          method: `research_${method}`,
          arguments: {},
        }),
      ).toThrow();
    }
    expect(() =>
      parseResearchSeriesRuntimeRequest({
        asset_type: 'index',
        identifier: '000300.SH',
        start: '20240101',
        end: '20241231',
        frequency: 'daily',
        transform: 'level',
        measure: 'market.cny_close',
      }),
    ).toThrow();
  });

  it.each(['equity.cn.csi300.price', 'equity.hk.hsi.price', 'equity.us.spx.price'])(
    'rejects retired benchmark %s before querying a replacement price series',
    async (id) => {
      await expect(
        loadResearchSeries(
          {
            type: 'series',
            id,
            source: { kind: 'instrument', assetType: 'index', id },
            measure: 'market.adjusted_close',
            transform: 'level',
          },
          '20240101',
          '20241231',
        ),
      ).rejects.toMatchObject({ reason: 'dataset_retired' });
    },
  );

  it('does not reinterpret a saved macro protocol as a legacy cross-section', () => {
    const spec = {
      version: 1,
      analysisKind: 'macro_regime',
      freq: 'month',
      neutral: 'none',
      start: '20240101',
      end: '20241231',
    };
    expect(() => normalizeFactorResearchSpec(spec)).toThrow();
    expect(isRetiredFactorReport({ specJson: JSON.stringify(spec) })).toBe(true);
    expect(isRetiredFactorReport({ analysisKind: 'macro_regime', specJson: null })).toBe(true);
  });

  it.each(['typescript', 'python'] as const)(
    'rejects saved curve inputs in %s while initializing the actual sandbox',
    async (language) => {
      const field = 'rates.cgb.yield.10y';
      const code =
        language === 'typescript'
          ? `export default defineFactorV2({ version: 2, name: 'Saved curve', analysisKind: 'time_series', outputScope: 'asset', frequency: 'daily', inputs: ['${field}'], targetAssetClasses: ['fixed_income'], window: 2, compute(ctx) { return ctx.value('${field}'); } });`
          : `from jixie import Factor, AssetFactorContext\nfactor = Factor.time_series(name="Saved curve", inputs=["${field}"], target_asset_classes=["fixed_income"], window=2)\n@factor.compute\ndef score(ctx: AssetFactorContext) -> float | None:\n    return ctx.value("${field}")\n`;
      const previousLocal = process.env.JIXIE_PYTHON_LOCAL;
      process.env.JIXIE_PYTHON_LOCAL = '1';
      let sandbox: Awaited<ReturnType<typeof FactorSandbox.start>> | undefined;
      try {
        await expect(
          (async () => {
            sandbox = await FactorSandbox.start({ language, analysisKind: 'time_series', code });
          })(),
        ).rejects.toThrow(/input field/);
      } finally {
        sandbox?.close();
        if (previousLocal === undefined) {
          delete process.env.JIXIE_PYTHON_LOCAL;
        } else {
          process.env.JIXIE_PYTHON_LOCAL = previousLocal;
        }
      }
    },
  );
});
