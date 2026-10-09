import type { FactorDefinition } from '#backtesting/factors/execution-port.js';
import { canonicalJson, sha256 } from '#factor/sources/fingerprint.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrategyFactor, type StrategyFactorInput } from './factor.js';

const mocks = vi.hoisted(() => ({
  preparationAllowed: false,
  runtimeStart: vi.fn(),
  factorFindMany: vi.fn(),
  compositeFindMany: vi.fn(),
  reportFindMany: vi.fn(),
}));

vi.mock('#factor/runtime/factor-runtime.js', () => ({
  FactorRuntime: { start: mocks.runtimeStart },
}));

vi.mock('#infra/database/prisma.js', () => {
  if (!mocks.preparationAllowed) {
    throw new Error('Source-only factor operations must not load the database');
  }
  return {
    prisma: {
      factor: { findMany: mocks.factorFindMany },
      factorComposite: { findMany: mocks.compositeFindMany },
      factorReport: { findMany: mocks.reportFindMany },
    },
  };
});

vi.mock('#infra/runtime/typescript/compile.js', async (importOriginal) => {
  if (!mocks.preparationAllowed) {
    throw new Error('Source-only factor operations must not load the compiler');
  }
  return importOriginal<typeof import('#infra/runtime/typescript/compile.js')>();
});

// Keep source-only checks before preparation loads the mocked dependencies.
describe('strategy factor references', () => {
  it('returns an empty preparation without loading the database or compiler', async () => {
    await expect(StrategyFactor.fromStrategySource('factors: []', 'owner')).resolves.toEqual([]);
  });

  it('finds raw keys in both the declaration and direct calls', () => {
    expect(
      StrategyFactor.extractKeys(`
        export default defineStrategy({
          factors: ['book_to_market', 'mf_net_main'],
          onBar(ctx) { return ctx.factor('quality_score', '000001.SZ'); },
        });
      `),
    ).toEqual(['quality_score', 'book_to_market']);
    expect(StrategyFactor.extractKeys(`strategy = Strategy(factors=["python_value"])`)).toEqual([
      'python_value',
    ]);
  });

  it('keeps direct-call order before declaration order and deduplicates across both', () => {
    expect(
      StrategyFactor.extractKeys(`
        factors: ['declared_first', 'shared_key', 'declared_first'];
        ctx . factor ('called_first', 'A');
        ctx.factor("shared_key", 'A');
        ctx.factor('called_first', 'B');
        factors = ["python_last", "shared_key"];
      `),
    ).toEqual(['called_first', 'shared_key', 'declared_first', 'python_last']);
  });

  it('filters engine keys and invalid identifiers without evaluating dynamic expressions', () => {
    expect(
      StrategyFactor.extractKeys(`
        factors: ['mf_net_main', 'Uppercase', 'has-dash', '1starts_with_digit', '${'a'.repeat(33)}'];
        ctx.factor('mf_net_main', 'A');
        ctx.factor('', 'A');
        ctx.factor(keyVariable, 'A');
        factors = loadFactorKeys();
      `),
    ).toEqual([]);
    expect(StrategyFactor.extractKeys('')).toEqual([]);
  });
});

const input: StrategyFactorInput = {
  factorId: 'factor-1',
  key: 'trend',
  name: 'Trend',
  codeHash: 'hash',
  approvedReportId: 'report-1',
  analysisKind: 'time_series',
  language: 'typescript',
  runtimeVersion: 'ts-v1',
  js: 'private source',
  assetSeries: { window: 2, inputs: ['etf.adjustedClose'] },
};
const factor = new StrategyFactor(input);

describe('strategy factor boundaries', () => {
  it('serializes only report lineage and derives inputs from runtime metadata', () => {
    const snapshot = factor.toDependency({
      id: factor.key,
      kind: 'asset_series',
      analysisKind: 'time_series',
      meta: input.assetSeries!,
    });
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual({
      factorId: 'factor-1',
      key: 'trend',
      name: 'Trend',
      codeHash: 'hash',
      approvedReportId: 'report-1',
      analysisKind: 'time_series',
      language: 'typescript',
      runtimeVersion: 'ts-v1',
      inputs: ['etf.adjustedClose'],
    });
    snapshot.inputs!.push('rates.cgb.yield.10y');
    expect(factor.assetSeries!.inputs).toEqual(['etf.adjustedClose']);
  });

  it('exposes runtime inputs while keeping report serialization separate', () => {
    const module = factor;
    expect(module).toMatchObject({
      key: 'trend',
      js: 'private source',
      assetSeries: factor.assetSeries,
    });
    expect(module).not.toHaveProperty('factorId');
    expect(module).not.toHaveProperty('approvedReportId');
  });

  it('preserves the existing macro-regime runtime mapping without changing report kind', () => {
    const macro = new StrategyFactor({
      ...input,
      analysisKind: 'macro_regime',
      assetSeries: undefined,
    });
    expect(macro.runtimeKind).toBe('cross_sectional');
    expect(macro.toDependency().analysisKind).toBe('macro_regime');
    expect(macro.toDependency()).not.toHaveProperty('inputs');
  });
});

const dependency = {
  factorId: 'factor-1',
  key: 'trend',
  name: 'Trend',
  analysisKind: 'panel' as const,
  codeHash: 'hash',
  approvedReportId: 'report-1',
};

describe('strategy factor metadata', () => {
  it('derives composite lineage inputs without modifying source factors', () => {
    const definition: FactorDefinition = {
      id: 'trend',
      kind: 'panel_composite',
      standardization: 'rank',
      assetUniverse: [],
      components: [
        {
          direction: 'positive',
          definition: {
            id: 'a',
            kind: 'asset_series',
            analysisKind: 'panel',
            meta: { window: 21, inputs: ['etf.adjustedClose'] },
          },
        },
        {
          direction: 'negative',
          definition: {
            id: 'b',
            kind: 'asset_series',
            analysisKind: 'panel',
            meta: { window: 61, inputs: ['etf.adjustedClose', 'rates.cgb.yield.10y'] },
          },
        },
      ],
    };
    const factor = new StrategyFactor(dependency);
    StrategyFactor.validateRuntimeMetadata([factor], [definition]);
    expect(factor.toDependency(definition)).toEqual({
      ...dependency,
      inputs: ['etf.adjustedClose', 'rates.cgb.yield.10y'],
    });
    expect(factor.assetSeries).toBeUndefined();
    expect(factor.toDependency()).not.toHaveProperty('inputs');
    expect(dependency).not.toHaveProperty('inputs');
  });

  it('rejects research-only fields inside composite components', () => {
    expect(() =>
      StrategyFactor.validateRuntimeMetadata(
        [new StrategyFactor(dependency)],
        [
          {
            id: 'trend',
            kind: 'panel_composite',
            standardization: 'rank',
            assetUniverse: [],
            components: [
              {
                direction: 'positive',
                definition: {
                  id: 'a',
                  kind: 'asset_series',
                  analysisKind: 'panel',
                  meta: { window: 21, inputs: ['commodity.warehouseReceipt.volume'] },
                },
              },
            ],
          },
        ],
      ),
    ).toThrow(expect.objectContaining({ reason: 'research_only_inputs_unavailable' }));
  });

  it('fails closed when a dependency has no runtime definition', () => {
    expect(() =>
      StrategyFactor.validateRuntimeMetadata([new StrategyFactor(dependency)], []),
    ).toThrow('Missing factor metadata');
  });
});

describe('strategy factor state isolation', () => {
  it('does not mutate prepared factors or share metadata between runs', () => {
    const original = new StrategyFactor({ ...input, assetSeries: undefined });
    const first = original.toDependency({
      id: input.key,
      kind: 'asset_series',
      analysisKind: 'time_series',
      meta: { window: 2, inputs: ['etf.adjustedClose'] },
    });
    const second = original.toDependency({
      id: input.key,
      kind: 'asset_series',
      analysisKind: 'time_series',
      meta: { window: 3, inputs: ['rates.cgb.yield.10y'] },
    });
    first.inputs!.push('rates.cgb.yield.2y');
    expect(original.assetSeries).toBeUndefined();
    expect(original.toDependency()).not.toHaveProperty('inputs');
    expect(second.inputs).toEqual(['rates.cgb.yield.10y']);
  });

  it('keeps composite child instances and freezes the surrounding input collections', () => {
    const child = new StrategyFactor({ ...input, analysisKind: 'panel' });
    const composite = {
      standardization: 'rank' as const,
      assetUniverse: [{ assetId: 'A', assetClass: 'cn_equity' as const }],
      components: [{ direction: 'positive' as const, factor: child }],
    };
    const parent = new StrategyFactor({
      ...input,
      analysisKind: 'panel',
      panelComposite: composite,
    });
    composite.components.length = 0;
    composite.assetUniverse[0].assetId = 'changed';
    const first = parent.panelComposite!;
    expect(first.components[0].factor).toBe(child);
    expect(first.components[0].factor).toBeInstanceOf(StrategyFactor);
    first.assetUniverse[0].assetId = 'changed again';
    first.components.length = 0;
    expect(parent.panelComposite!.components).toHaveLength(1);
    expect(parent.panelComposite!.assetUniverse[0].assetId).toBe('A');
    expect(parent.toDependency()).not.toHaveProperty('panelComposite');
    expect(parent.toDependency()).not.toHaveProperty('js');
  });

  it('rejects metadata belonging to a different factor', () => {
    expect(() =>
      factor.toDependency({ id: 'other', kind: 'cross_sectional', historyFields: [] }),
    ).toThrow('Factor metadata does not match');
  });
});

describe('strategy factor lineage', () => {
  const dependency = {
    factorId: 'factor-1',
    key: 'ep',
    name: 'EP',
    analysisKind: 'cross_sectional' as const,
    codeHash: 'abc123',
    approvedReportId: 'report-1',
  };

  it('parses valid dependency snapshots and preserves null rows', () => {
    expect(StrategyFactor.dependenciesFromJson([dependency])).toEqual([dependency]);
    expect(StrategyFactor.dependenciesFromJson(null)).toBeNull();
  });

  it('rejects malformed snapshots', () => {
    expect(() => StrategyFactor.dependenciesFromJson({ ...dependency })).toThrow(
      'Invalid factor dependency snapshot',
    );
    expect(() => StrategyFactor.dependenciesFromJson([{ ...dependency, key: '' }])).toThrow(
      'Invalid factor dependency snapshot',
    );
    expect(() => StrategyFactor.dependenciesFromJson([{ ...dependency, inputs: [''] }])).toThrow(
      'Invalid factor dependency snapshot',
    );
  });

  it('detects dependency drift independent of source order', () => {
    expect(() => StrategyFactor.assertDependencies([dependency], [dependency])).not.toThrow();
    expect(() =>
      StrategyFactor.assertDependencies([dependency], [{ ...dependency, codeHash: 'changed' }]),
    ).toThrow('Factor dependency snapshot mismatch');
    expect(() => StrategyFactor.assertDependencies(null, [dependency])).not.toThrow();
  });

  it('normalizes legacy TypeScript metadata but rejects language or runtime drift', () => {
    expect(() =>
      StrategyFactor.assertDependencies(
        [dependency],
        [{ ...dependency, language: 'typescript', runtimeVersion: 'ts-v1' }],
      ),
    ).not.toThrow();
    expect(() =>
      StrategyFactor.assertDependencies(
        [dependency],
        [{ ...dependency, language: 'python', runtimeVersion: 'py-v1' }],
      ),
    ).toThrow('Factor dependency snapshot mismatch');
  });

  it('freezes Definition V2 inputs independent of declaration order', () => {
    const expected = {
      ...dependency,
      analysisKind: 'time_series' as const,
      inputs: ['rates.cgb.yield.10y', 'rates.cgb.yield.2y'],
    };
    expect(() =>
      StrategyFactor.assertDependencies(
        [expected],
        [{ ...expected, inputs: ['rates.cgb.yield.2y', 'rates.cgb.yield.10y'] }],
      ),
    ).not.toThrow();
    expect(() =>
      StrategyFactor.assertDependencies(
        [expected],
        [{ ...expected, inputs: ['rates.cgb.yield.10y'] }],
      ),
    ).toThrow('Factor dependency snapshot mismatch');
  });
});

const SOURCE = `export default defineFactor({ compute: (bar) => bar.pb });`;

function factorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'factor-1',
    key: 'book_to_market',
    name: 'Book to market',
    code: SOURCE,
    analysisKind: 'cross_sectional',
    codeHash: 'abc123',
    approvedReportId: 'report-1',
    userId: 'user-1',
    ...overrides,
  };
}

describe('published factor preparation', () => {
  beforeEach(() => {
    mocks.preparationAllowed = true;
    mocks.runtimeStart
      .mockReset()
      .mockRejectedValue(new Error('Preparation must not start a runtime'));
    mocks.factorFindMany.mockReset().mockResolvedValue([factorRow()]);
    mocks.compositeFindMany.mockReset().mockResolvedValue([]);
    mocks.reportFindMany.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    mocks.preparationAllowed = false;
    expect(mocks.runtimeStart).not.toHaveBeenCalled();
  });

  it.each([
    ["ctx.history(252, 'turnoverRateF')", ['turnoverRateF']],
    ['ctx.history(21, "turnoverRateF")', ['turnoverRateF']],
    ["ctx.history(504, 'roe')", ['roe']],
    ["ctx.history(504, 'grossprofitMargin')", ['grossprofitMargin']],
    ["ctx.history(21, 'marketClose')", ['marketClose']],
    ['bar.roe && ctx.history(21)', []],
    ["ctx.history(21, 'amount')", []],
  ])(
    'extracts auxiliary data requirements while preparing source: %s',
    async (expression, expected) => {
      mocks.factorFindMany.mockResolvedValue([
        factorRow({
          code: `export default defineFactor({ compute(bar, ctx) { return ${expression}; } });`,
        }),
      ]);
      const factors = await StrategyFactor.fromStrategySource(
        "ctx.factor('book_to_market', 'A')",
        'user-1',
      );
      expect(factors[0].historyFields).toEqual(expected);
    },
  );

  it('loads the exact owned factor and records run lineage', async () => {
    const prepared = await StrategyFactor.fromStrategySource(
      `ctx.factor('book_to_market', '000001.SZ')`,
      'user-1',
    );

    expect(mocks.factorFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ key: { in: ['book_to_market'] } }),
      }),
    );
    expect(prepared[0].assetSeries).toBeUndefined();
    expect(prepared[0]).toMatchObject({ key: 'book_to_market' });
    expect(prepared[0].js).toContain('defineFactor');
    expect(prepared.map((factor) => factor.toDependency())).toEqual([
      {
        factorId: 'factor-1',
        key: 'book_to_market',
        name: 'Book to market',
        analysisKind: 'cross_sectional',
        language: 'typescript',
        runtimeVersion: 'ts-v1',
        codeHash: 'abc123',
        approvedReportId: 'report-1',
      },
    ]);
  });

  it('prepares a published py-v1 Factor without transpiling it to JavaScript', async () => {
    const code = `
from jixie import Factor, FactorBar, CrossSectionalFactorContext
factor = Factor.cross_sectional(name="Python value")
@factor.compute
def compute(bar: FactorBar, ctx: CrossSectionalFactorContext) -> float | None:
    return bar.pb
`;
    mocks.factorFindMany.mockResolvedValue([
      factorRow({
        key: 'python_value',
        code,
        language: 'python',
        runtimeVersion: 'py-v1',
      }),
    ]);

    const prepared = await StrategyFactor.fromStrategySource(
      `strategy = Strategy(factors=["python_value"])`,
      'user-1',
    );

    expect(prepared[0].assetSeries).toBeUndefined();
    expect(prepared[0]).toMatchObject({
      key: 'python_value',
      language: 'python',
      runtimeVersion: 'py-v1',
      code,
      analysisKind: 'cross_sectional',
    });
    expect(prepared[0].js).toBeUndefined();
    expect(prepared[0].toDependency()).toMatchObject({
      language: 'python',
      runtimeVersion: 'py-v1',
    });
  });

  it('prepares time-series source without probing runtime metadata', async () => {
    mocks.factorFindMany.mockResolvedValue([
      factorRow({
        key: 'etf_trend_20',
        analysisKind: 'time_series',
        code: `export default defineFactorV2({
          version: 2,
          name: 'ETF trend',
          analysisKind: 'time_series',
          outputScope: 'asset',
          frequency: 'daily',
          inputs: ['etf.adjustedClose'],
          targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
          window: 21,
          compute(ctx) { return ctx.value('etf.adjustedClose'); },
        });`,
      }),
    ]);

    const prepared = await StrategyFactor.fromStrategySource(
      `ctx.factor('etf_trend_20', '510300.SH')`,
      'user-1',
    );
    expect(prepared[0].assetSeries).toBeUndefined();
    expect(prepared[0]).toMatchObject({
      key: 'etf_trend_20',
      analysisKind: 'time_series',
    });
  });

  it('defers research-only input validation to execution initialization', async () => {
    mocks.factorFindMany.mockResolvedValue([
      factorRow({
        key: 'warehouse_pressure_20_v1',
        userId: 'builtin',
        analysisKind: 'time_series',
        code: `export default defineFactorV2({
          version: 2,
          name: 'Commodity warehouse-receipt pressure',
          analysisKind: 'time_series',
          outputScope: 'asset',
          frequency: 'daily',
          inputs: ['commodity.warehouseReceipt.volume'],
          targetAssetClasses: ['commodity'],
          window: 21,
          compute(ctx) { return ctx.value('commodity.warehouseReceipt.volume'); },
        });`,
      }),
    ]);

    await expect(
      StrategyFactor.fromStrategySource(
        `ctx.factor('warehouse_pressure_20_v1', '518880.SH')`,
        'user-1',
      ),
    ).resolves.toMatchObject([{ key: 'warehouse_pressure_20_v1' }]);
  });

  it('carries a published panel factor into the same asset-series strategy runtime', async () => {
    mocks.factorFindMany.mockResolvedValue([
      factorRow({
        key: 'cross_asset_momentum_120',
        analysisKind: 'panel',
        code: `export default defineFactorV2({
          version: 2,
          name: 'Cross-asset momentum',
          analysisKind: 'panel',
          outputScope: 'asset',
          frequency: 'daily',
          inputs: ['etf.adjustedClose'],
          targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
          window: 121,
          compute(ctx) { return ctx.value('etf.adjustedClose'); },
        });`,
      }),
    ]);
    mocks.reportFindMany.mockResolvedValue([
      {
        id: 'report-1',
        factorCodeSnapshot: null,
        specJson: JSON.stringify({
          version: 1,
          analysisKind: 'panel',
          start: '20200101',
          end: '20241231',
          observationFrequency: 'monthly',
          assets: [
            { assetId: '510300.SH', assetClass: 'cn_equity' },
            { assetId: '511010.SH', assetClass: 'fixed_income' },
            { assetId: '518880.SH', assetClass: 'gold' },
          ],
          target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
          dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: '20241231' },
          rankingScope: 'cross_asset',
          volatilityScaling: 'none',
          minimumAssetsPerPeriod: 3,
          portfolio: { topFraction: 0.25, bottomFraction: 0.25, transactionCostPerSide: 0.001 },
        }),
      },
    ]);

    const prepared = await StrategyFactor.fromStrategySource(
      `ctx.factor('cross_asset_momentum_120', '510300.SH')`,
      'user-1',
    );
    expect(prepared[0].assetSeries).toBeUndefined();
    expect(prepared[0]).toMatchObject({
      key: 'cross_asset_momentum_120',
      analysisKind: 'panel',
      assetUniverse: [
        { assetId: '510300.SH', assetClass: 'cn_equity' },
        { assetId: '511010.SH', assetClass: 'fixed_income' },
        { assetId: '518880.SH', assetClass: 'gold' },
      ],
    });
    expect(prepared[0].toDependency()).toMatchObject({
      key: 'cross_asset_momentum_120',
      analysisKind: 'panel',
    });
  });

  it('compiles a published panel composite from its frozen approved report bundle', async () => {
    const componentCode = (name: string, periods: number) => `export default defineFactorV2({
      version: 2,
      name: '${name}',
      analysisKind: 'panel',
      outputScope: 'asset',
      frequency: 'daily',
      inputs: ['etf.adjustedClose'],
      targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
      window: ${periods + 1},
      compute(ctx) {
        const current = ctx.value('etf.adjustedClose');
        const previous = ctx.lag('etf.adjustedClose', ${periods});
        return current != null && previous != null ? current / previous - 1 : null;
      },
    });`;
    const source = canonicalJson({
      kind: 'panel_composite',
      label: 'Momentum and reversal',
      definition: {
        version: 2,
        key: 'momentum_reversal_panel',
        name: 'Momentum and reversal',
        analysisKind: 'panel',
        standardization: 'rank',
        weighting: 'equal',
        components: [
          { factor: 'component-1', direction: 'positive' },
          { factor: 'component-2', direction: 'negative' },
        ],
      },
      components: [
        {
          factor: 'component-1',
          label: 'Momentum',
          direction: 'positive',
          code: componentCode('Momentum', 20),
        },
        {
          factor: 'component-2',
          label: 'Reversal',
          direction: 'negative',
          code: componentCode('Reversal', 60),
        },
      ],
    });
    mocks.factorFindMany.mockResolvedValue([]);
    mocks.compositeFindMany.mockResolvedValue([
      {
        id: 'composite-1',
        key: 'momentum_reversal_panel',
        name: 'Momentum and reversal',
        status: 'published',
        codeHash: sha256(source),
        approvedReportId: 'report-1',
      },
    ]);
    mocks.reportFindMany.mockResolvedValue([
      {
        id: 'report-1',
        factorCodeSnapshot: source,
        specJson: JSON.stringify({
          version: 1,
          analysisKind: 'panel',
          start: '20200101',
          end: '20241231',
          observationFrequency: 'monthly',
          assets: [
            { assetId: '510300.SH', assetClass: 'cn_equity' },
            { assetId: '511010.SH', assetClass: 'fixed_income' },
            { assetId: '518880.SH', assetClass: 'gold' },
          ],
          target: {
            kind: 'forward_total_return',
            horizon: 20,
            horizonUnit: 'trade_day',
          },
          dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: null },
          rankingScope: 'cross_asset',
          volatilityScaling: 'none',
          minimumAssetsPerPeriod: 3,
          portfolio: {
            topFraction: 0.25,
            bottomFraction: 0.25,
            transactionCostPerSide: 0.001,
          },
        }),
      },
    ]);

    const prepared = await StrategyFactor.fromStrategySource(
      `ctx.factor('momentum_reversal_panel', '510300.SH')`,
      'user-1',
    );

    expect(prepared[0].assetSeries).toBeUndefined();
    expect(prepared[0]).toMatchObject({
      key: 'momentum_reversal_panel',
      analysisKind: 'panel',
      panelComposite: {
        standardization: 'rank',
        assetUniverse: [
          { assetId: '510300.SH', assetClass: 'cn_equity' },
          { assetId: '511010.SH', assetClass: 'fixed_income' },
          { assetId: '518880.SH', assetClass: 'gold' },
        ],
        components: [
          { direction: 'positive', factor: { analysisKind: 'panel' } },
          { direction: 'negative', factor: { analysisKind: 'panel' } },
        ],
      },
    });
    expect(prepared.map((factor) => factor.toDependency())).toEqual([
      expect.objectContaining({
        factorId: 'composite-1',
        key: 'momentum_reversal_panel',
        analysisKind: 'panel',
        codeHash: sha256(source),
        approvedReportId: 'report-1',
      }),
    ]);
  });

  it('resolves deployment source while leaving inputs for admission inspection', async () => {
    mocks.factorFindMany.mockResolvedValue([
      factorRow({
        key: 'etf_trend_20',
        analysisKind: 'time_series',
        code: `export default defineFactorV2({
          version: 2,
          name: 'ETF trend',
          analysisKind: 'time_series',
          outputScope: 'asset',
          frequency: 'daily',
          inputs: ['etf.adjustedClose'],
          targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
          window: 21,
          compute(ctx) { return ctx.value('etf.adjustedClose'); },
        });`,
      }),
    ]);
    await expect(
      StrategyFactor.fromStrategySource(
        `ctx.factor('etf_trend_20', '510300.SH')`,
        'user-1',
        'deployment',
      ),
    ).resolves.toMatchObject([{ key: 'etf_trend_20' }]);
  });

  it('allows an archived dependency for an existing signal run', async () => {
    await expect(
      StrategyFactor.fromStrategySource(
        `ctx.factor('book_to_market', '000001.SZ')`,
        'user-1',
        'signal',
      ),
    ).resolves.toMatchObject([{ key: 'book_to_market' }]);
    expect(mocks.factorFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['published', 'archived'] } }),
      }),
    );
  });

  it('fails closed for missing or unpublished factors', async () => {
    mocks.factorFindMany.mockResolvedValue([]);
    await expect(
      StrategyFactor.fromStrategySource(`ctx.factor('book_to_market', '000001.SZ')`, 'user-1'),
    ).rejects.toThrow('book_to_market');
  });
});
