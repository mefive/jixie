import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrategyFactor, type StrategyFactorInput } from './strategy-factor.js';

const mocks = vi.hoisted(() => ({
  preparationAllowed: false,
  runtimeStart: vi.fn(),
  factorFindMany: vi.fn(),
  reportFindMany: vi.fn(),
}));

vi.mock('#factor/sandbox/factor-sandbox.js', () => ({
  FactorSandbox: { start: mocks.runtimeStart },
}));

vi.mock('#infra/database/prisma.js', async () => {
  if (!mocks.preparationAllowed) {
    throw new Error('Source-only factor operations must not load the database');
  }
  const mocked = {
    prisma: {
      factor: { findMany: mocks.factorFindMany },
      factorReport: { findMany: mocks.reportFindMany },
    },
  };
  return {
    ...(await vi.importActual<typeof import('#infra/database/prisma.js')>(
      '#infra/database/prisma.js',
    )),
    ...mocked,
    getDatabase: () => mocked.prisma,
  };
});

vi.mock('#infra/sandbox/typescript/compile.js', async (importOriginal) => {
  if (!mocks.preparationAllowed) {
    throw new Error('Source-only factor operations must not load the compiler');
  }
  return importOriginal<typeof import('#infra/sandbox/typescript/compile.js')>();
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
  it('fails closed when a dependency has no runtime definition', () => {
    expect(() =>
      StrategyFactor.validateSandboxMetadata([new StrategyFactor(dependency)], []),
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

  it('rejects metadata belonging to a different factor', () => {
    expect(() =>
      factor.toDependency({ id: 'other', kind: 'cross_sectional', historyFields: [] }),
    ).toThrow('Factor metadata does not match');
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
  it('loads several independent versions in declared order without a composite definition', async () => {
    mocks.factorFindMany.mockResolvedValue([
      factorRow({
        id: 'quality-id',
        key: 'quality',
        approvedReportId: 'quality-report',
        codeHash: 'quality-hash',
      }),
      factorRow({
        id: 'value-id',
        key: 'value',
        approvedReportId: 'value-report',
        codeHash: 'value-hash',
      }),
    ]);

    const factors = await StrategyFactor.fromStrategySource(
      "factors: ['value', 'quality']",
      'user-1',
    );

    expect(factors.map((factor) => factor.toDependency())).toMatchObject([
      {
        key: 'value',
        factorId: 'value-id',
        approvedReportId: 'value-report',
        codeHash: 'value-hash',
      },
      {
        key: 'quality',
        factorId: 'quality-id',
        approvedReportId: 'quality-report',
        codeHash: 'quality-hash',
      },
    ]);
    expect(mocks.factorFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['published', 'archived'] } }),
      }),
    );
  });

  beforeEach(() => {
    mocks.preparationAllowed = true;
    mocks.runtimeStart
      .mockReset()
      .mockRejectedValue(new Error('Preparation must not start a runtime'));
    mocks.factorFindMany.mockReset().mockResolvedValue([factorRow()]);
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

  it('fails closed for missing or unpublished factors', async () => {
    mocks.factorFindMany.mockResolvedValue([]);
    await expect(
      StrategyFactor.fromStrategySource(`ctx.factor('book_to_market', '000001.SZ')`, 'user-1'),
    ).rejects.toThrow('book_to_market');
  });
});
