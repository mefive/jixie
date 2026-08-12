import { describe, expect, it } from 'vitest';
import { runStrategy, runStrategyWithSignals } from './run.js';
import { runWalledBacktest } from './walled-run.js';
import { fixturePort, type FixtureSpec } from './fixture-port.js';
import { toCommonJs } from '../lib/isolate-run.js';
import type { Strategy } from './types.js';

/**
 * ctx.factor() time semantics (factor-to-strategy.md Step 2): a `flow` factor (moneyflow) is an
 * exact-day quantity — yesterday's net inflow must NEVER be served as today's. Before 3.2 the
 * engine blanket-applied as-of forward filling to every stored factor; these tests pin the fix.
 */

const D = ['20240101', '20240102', '20240103', '20240104', '20240105'];

function spec(): FixtureSpec {
  return {
    dates: D,
    stocks: [
      {
        code: 'A',
        bars: D.map((date) => ({ date, open: 10, close: 10, up: 11, down: 9 })),
      },
    ],
    // Moneyflow exists ONLY on D2 — D3+ must read null, not D2's value carried forward.
    moneyflow: [{ tsCode: 'A', tradeDate: D[1], netMain: 888, netTotal: 999 }],
  };
}

/** Record ctx.factor('mf_net_main') for stock A on every bar. */
function recordingStrategy(seen: Record<string, number | null>): Strategy {
  return {
    name: 'record mf',
    factors: ['mf_net_main'],
    onBar(ctx) {
      seen[ctx.date] = ctx.factor('mf_net_main', 'A');
    },
  };
}

describe('flow factor semantics (mf_net_*)', () => {
  it('serves the exact day and returns null after — no forward fill', async () => {
    const seen: Record<string, number | null> = {};
    await runStrategy({
      start: D[0],
      end: D[4],
      initialCash: 100_000,
      strategy: recordingStrategy(seen),
      dataPort: fixturePort(spec()),
    });

    expect(seen[D[0]]).toBeNull(); // before any data
    expect(seen[D[1]]).toBe(888); // the exact day
    expect(seen[D[2]]).toBeNull(); // the old behavior forward-filled 888 here
    expect(seen[D[4]]).toBeNull();
  });

  it('rejects an unknown factor key at load instead of serving silent nulls', async () => {
    const bogus: Strategy = { name: 'bogus', factors: ['mf_net_mian'], onBar() {} };
    await expect(
      runStrategy({
        start: D[0],
        end: D[4],
        initialCash: 100_000,
        strategy: bogus,
        dataPort: fixturePort(spec()),
      }),
    ).rejects.toThrow(/mf_net_mian/);
  });

  it('a declared custom key without a prepared module fails loudly (deleted/foreign factor)', async () => {
    const custom: Strategy = {
      name: 'custom ref',
      factors: ['missing_factor'],
      onBar() {},
    };
    await expect(
      runStrategy({
        start: D[0],
        end: D[4],
        initialCash: 100_000,
        strategy: custom,
        dataPort: fixturePort(spec()),
      }),
    ).rejects.toThrow(/missing_factor/);
  });
});

describe('custom (defineFactor) factors inside the engine', () => {
  function specWithValuation(): FixtureSpec {
    const base = spec();
    base.stocks[0].basic = Object.fromEntries(D.map((date) => [date, { peTtm: 10 }]));
    return base;
  }

  it('cross-sectional factor computes from the day bar (peTtm doubled)', async () => {
    const js = await toCommonJs(
      `export default defineFactor({ name: 'double pe', compute: (bar) => (bar.peTtm == null ? null : bar.peTtm * 2) });`,
      'factor code',
    );
    const seen: Record<string, number | null> = {};
    const strategy: Strategy = {
      name: 'read custom',
      factors: ['f1'],
      async onBar(ctx) {
        await ctx.loadCrossSection();
        seen[ctx.date] = ctx.factor('f1', 'A');
      },
    };
    await runStrategy({
      start: D[0],
      end: D[4],
      initialCash: 100_000,
      strategy,
      dataPort: fixturePort(specWithValuation()),
      customFactors: [{ key: 'f1', js }],
    });
    expect(seen[D[0]]).toBe(20);
    expect(seen[D[4]]).toBe(20);
  });

  it('executes an immutable Factor key through the same computed-factor runtime', async () => {
    const factorKey = 'etf_trend_20';
    const js = await toCommonJs(
      `export default defineFactor({ compute: (bar) => bar.peTtm });`,
      'published factor code',
    );
    const seen: Record<string, number | null> = {};
    const strategy: Strategy = {
      name: 'read published factor',
      factors: [factorKey],
      async onBar(ctx) {
        await ctx.loadCrossSection();
        seen[ctx.date] = ctx.factor(factorKey, 'A');
      },
    };
    const output = await runStrategyWithSignals({
      start: D[0],
      end: D[4],
      initialCash: 100_000,
      strategy,
      dataPort: fixturePort(specWithValuation()),
      customFactors: [{ key: factorKey, js }],
    });
    expect(seen[D[0]]).toBe(10);
    expect(seen[D[4]]).toBe(10);
    expect(output.capture.factorObservations).toEqual([{ key: factorKey, code: 'A', value: 10 }]);
  });

  it('executes an ETF time-series Factor from adjusted history on direct and walled lanes', async () => {
    const factorKey = 'etf_trend_20';
    const etfCode = '510300.SH';
    const timeSeriesSpec: FixtureSpec = {
      dates: D,
      stocks: [
        {
          code: etfCode,
          assetType: 'etf',
          bars: D.map((date, index) => ({
            date,
            open: 10 + index,
            close: 10 + index,
            adj: index < 2 ? 1 : 2,
          })),
        },
        {
          code: 'A',
          bars: D.map((date, index) => ({
            date,
            open: 20 + index,
            close: 20 + index,
          })),
        },
      ],
    };
    const js = await toCommonJs(
      `export default defineFactorV2({
        version: 2,
        name: 'ETF two-day adjusted trend',
        analysisKind: 'time_series',
        outputScope: 'asset',
        frequency: 'daily',
        inputs: ['etf.adjustedClose'],
        targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
        window: 3,
        compute(ctx) {
          const current = ctx.value('etf.adjustedClose');
          const previous = ctx.lag('etf.adjustedClose', 2);
          return current != null && previous != null ? current / previous - 1 : null;
        },
      });`,
      'time-series factor code',
    );
    const module = {
      key: factorKey,
      js,
      analysisKind: 'time_series' as const,
      assetSeries: { window: 3, inputs: ['etf.adjustedClose' as const] },
    };
    const seen: Record<string, number | null> = {};
    const invalidSeen: Record<string, number | null> = {};
    const directLogs: string[] = [];
    const strategy: Strategy = {
      name: 'read ETF time-series factor',
      watch: [etfCode, 'A'],
      factors: [factorKey],
      onBar(ctx) {
        seen[ctx.date] = ctx.factor(factorKey, etfCode);
        invalidSeen[ctx.date] = ctx.factor(factorKey, 'A');
      },
    };

    const output = await runStrategyWithSignals({
      start: D[0],
      end: D[4],
      initialCash: 100_000,
      strategy,
      dataPort: fixturePort(timeSeriesSpec),
      customFactors: [module],
      onLog: (line) => directLogs.push(line),
    });
    expect(seen[D[1]]).toBeNull();
    expect(seen[D[2]]).toBeCloseTo(24 / 10 - 1);
    expect(seen[D[4]]).toBeCloseTo(28 / 24 - 1);
    expect(invalidSeen[D[4]]).toBeNull();
    expect(directLogs).toContain(
      `[factor-error] ${factorKey}: input etf.adjustedClose requires an ETF code, received A`,
    );
    expect(output.capture.factorObservations).toEqual(
      expect.arrayContaining([
        { key: factorKey, code: 'A', value: null },
        { key: factorKey, code: etfCode, value: expect.closeTo(28 / 24 - 1) },
      ]),
    );

    const logged: string[] = [];
    await runWalledBacktest(
      {
        code: `export default defineStrategy({
          name: 'walled ETF time-series factor',
          watch: ['${etfCode}', 'A'],
          factors: ['${factorKey}'],
          onBar(ctx) {
            console.log(ctx.date + '=' + String(ctx.factor('${factorKey}', '${etfCode}')));
            console.log(ctx.date + '=stock=' + String(ctx.factor('${factorKey}', 'A')));
          },
        });`,
        start: D[0],
        end: D[4],
        initialCash: 100_000,
        customFactors: [module],
      },
      fixturePort(timeSeriesSpec),
      undefined,
      (_level, text) => logged.push(text),
    );
    expect(logged).toContain(`${D[1]}=null`);
    expect(logged).toContain(`${D[4]}=${28 / 24 - 1}`);
    expect(logged).toContain(`${D[4]}=stock=null`);
  });

  it('standardizes a frozen panel composite across the explicit strategy watch universe', async () => {
    const factorKey = 'momentum_reversal_panel';
    const assetCodes = ['ETF_A', 'ETF_B', 'ETF_C'];
    const panelSpec: FixtureSpec = {
      dates: D,
      stocks: assetCodes.map((code, assetIndex) => ({
        code,
        assetType: 'etf' as const,
        bars: D.map((date, dateIndex) => {
          const first = [30, 20, 10][assetIndex];
          const later = [10, 20, 30][assetIndex];
          const close = dateIndex === 0 ? first : later;
          return { date, open: close, close };
        }),
      })),
    };
    const panelModule = async (key: string, body: string) => ({
      key,
      js: await toCommonJs(
        `export default defineFactorV2({
          version: 2,
          name: '${key}',
          analysisKind: 'panel',
          outputScope: 'asset',
          frequency: 'daily',
          inputs: ['etf.adjustedClose'],
          targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
          window: 2,
          compute(ctx) { ${body} },
        });`,
        'panel component code',
      ),
      analysisKind: 'panel' as const,
      assetSeries: { window: 2, inputs: ['etf.adjustedClose' as const] },
    });
    const compositeModule = {
      key: factorKey,
      analysisKind: 'panel' as const,
      assetSeries: { window: 2, inputs: ['etf.adjustedClose' as const] },
      panelComposite: {
        standardization: 'rank' as const,
        assetUniverse: [
          { assetId: 'ETF_A', assetClass: 'cn_equity' as const },
          { assetId: 'ETF_B', assetClass: 'fixed_income' as const },
          { assetId: 'ETF_C', assetClass: 'commodity' as const },
        ],
        components: [
          {
            direction: 'positive' as const,
            module: await panelModule('current_price', `return ctx.value('etf.adjustedClose');`),
          },
          {
            direction: 'negative' as const,
            module: await panelModule('previous_price', `return ctx.lag('etf.adjustedClose', 1);`),
          },
        ],
      },
    };
    const seen: Record<string, Record<string, number | null>> = {};
    const strategy: Strategy = {
      name: 'rank panel composite',
      watch: assetCodes,
      factors: [factorKey],
      onBar(ctx) {
        seen[ctx.date] = Object.fromEntries(
          assetCodes.map((code) => [code, ctx.factor(factorKey, code)]),
        );
      },
    };

    await runStrategy({
      start: D[0],
      end: D[4],
      initialCash: 100_000,
      strategy,
      dataPort: fixturePort(panelSpec),
      customFactors: [compositeModule],
    });

    expect(seen[D[0]]).toEqual({ ETF_A: null, ETF_B: null, ETF_C: null });
    expect(seen[D[1]]).toEqual({ ETF_A: -0.5, ETF_B: 0, ETF_C: 0.5 });

    const logged: string[] = [];
    await runWalledBacktest(
      {
        code: `export default defineStrategy({
          name: 'walled panel composite',
          watch: ['ETF_A', 'ETF_B', 'ETF_C'],
          factors: ['${factorKey}'],
          onBar(ctx) {
            console.log(ctx.date + '=' + ['ETF_A', 'ETF_B', 'ETF_C']
              .map((code) => String(ctx.factor('${factorKey}', code))).join(','));
          },
        });`,
        start: D[0],
        end: D[4],
        initialCash: 100_000,
        customFactors: [compositeModule],
      },
      fixturePort(panelSpec),
      undefined,
      (_level, text) => logged.push(text),
    );
    expect(logged).toContain(`${D[1]}=-0.5,0,0.5`);

    await expect(
      runStrategy({
        start: D[0],
        end: D[4],
        initialCash: 100_000,
        strategy: { ...strategy, watch: ['ETF_A', 'ETF_B'] },
        dataPort: fixturePort(panelSpec),
        customFactors: [compositeModule],
      }),
    ).rejects.toThrow('approved research universe');
  });

  it('executes an official yield-curve Factor using only values available by the decision date', async () => {
    const factorKey = 'cgb_yield_decline_1';
    const etfCode = '511010.SH';
    const rateSpec: FixtureSpec = {
      dates: D,
      stocks: [
        {
          code: etfCode,
          assetType: 'etf',
          bars: D.map((date) => ({ date, open: 100, close: 100 })),
        },
      ],
      yieldCurvePoints: [
        { availableDate: D[1], termYears: 10, yieldPct: 3 },
        { availableDate: D[3], termYears: 10, yieldPct: 2.5 },
      ],
    };
    const js = await toCommonJs(
      `export default defineFactorV2({
        version: 2,
        name: 'One-day 10Y yield decline',
        analysisKind: 'time_series',
        outputScope: 'asset',
        frequency: 'daily',
        inputs: ['rates.cgb.yield.10y'],
        targetAssetClasses: ['fixed_income'],
        window: 2,
        compute(ctx) {
          const current = ctx.value('rates.cgb.yield.10y');
          const previous = ctx.lag('rates.cgb.yield.10y', 1);
          return current != null && previous != null ? (previous - current) * 100 : null;
        },
      });`,
      'yield-curve factor code',
    );
    const module = {
      key: factorKey,
      js,
      analysisKind: 'time_series' as const,
      assetSeries: { window: 2, inputs: ['rates.cgb.yield.10y' as const] },
    };
    const seen: Record<string, number | null> = {};

    await runStrategy({
      start: D[0],
      end: D[4],
      initialCash: 100_000,
      strategy: {
        name: 'read official yield curve',
        watch: [etfCode],
        factors: [factorKey],
        onBar(ctx) {
          seen[ctx.date] = ctx.factor(factorKey, etfCode);
        },
      },
      dataPort: fixturePort(rateSpec),
      customFactors: [module],
    });

    expect(seen[D[0]]).toBeNull();
    expect(seen[D[1]]).toBeNull();
    expect(seen[D[2]]).toBe(0);
    expect(seen[D[3]]).toBe(50);
    expect(seen[D[4]]).toBe(0);

    const logged: string[] = [];
    await runWalledBacktest(
      {
        code: `export default defineStrategy({
          name: 'walled official yield curve',
          watch: ['${etfCode}'],
          factors: ['${factorKey}'],
          onBar(ctx) {
            console.log(ctx.date + '=' + String(ctx.factor('${factorKey}', '${etfCode}')));
          },
        });`,
        start: D[0],
        end: D[4],
        initialCash: 100_000,
        customFactors: [module],
      },
      fixturePort(rateSpec),
      undefined,
      (_level, text) => logged.push(text),
    );
    expect(logged).toContain(`${D[2]}=0`);
    expect(logged).toContain(`${D[3]}=50`);
  });

  it('windowed factor reads ctx.history from the engine bars cache (after ensureBars)', async () => {
    const js = await toCommonJs(
      `export default defineFactor({
        name: 'sum3',
        window: 3,
        compute(bar, ctx) {
          const closes = ctx.history(3);
          if (closes.length < 3) { return null; }
          return closes[0] + closes[1] + closes[2];
        },
      });`,
      'factor code',
    );
    const seen: Record<string, number | null> = {};
    const strategy: Strategy = {
      name: 'read windowed',
      factors: ['w1'],
      async onBar(ctx) {
        await ctx.ensureBars(['A']);
        seen[ctx.date] = ctx.factor('w1', 'A');
      },
    };
    await runStrategy({
      start: D[0],
      end: D[4],
      initialCash: 100_000,
      strategy,
      dataPort: fixturePort(spec()),
      customFactors: [{ key: 'w1', js }],
    });
    expect(seen[D[0]]).toBeNull(); // only 1 bar of history — window unfilled
    expect(seen[D[1]]).toBeNull();
    expect(seen[D[2]]).toBe(30); // three 10-yuan closes
    expect(seen[D[4]]).toBe(30);
  });

  it('windowed factor reads aligned turnover amounts inside the backtest engine', async () => {
    const amountSpec = spec();
    amountSpec.stocks[0].bars = D.map((date, index) => ({
      date,
      open: 10,
      close: 10,
      up: 11,
      down: 9,
      amount: (index + 1) * 100,
    }));
    const js = await toCommonJs(
      `export default defineFactor({
        name: 'amount3',
        window: 3,
        compute(bar, ctx) {
          const amounts = ctx.history(3, 'amount');
          if (amounts.length < 3 || amounts.some((value) => value == null)) { return null; }
          return amounts.reduce((sum, value) => sum + value, 0);
        },
      });`,
      'factor code',
    );
    const seen: Record<string, number | null> = {};
    const strategy: Strategy = {
      name: 'read amount history',
      factors: ['amount'],
      async onBar(ctx) {
        await ctx.ensureBars(['A']);
        seen[ctx.date] = ctx.factor('amount', 'A');
      },
    };

    await runStrategy({
      start: D[0],
      end: D[4],
      initialCash: 100_000,
      strategy,
      dataPort: fixturePort(amountSpec),
      customFactors: [{ key: 'amount', js }],
    });

    expect(seen[D[1]]).toBeNull();
    expect(seen[D[2]]).toBe(600);
    expect(seen[D[4]]).toBe(1200);
  });

  it('loads aligned free-float turnover history only when the factor declares it', async () => {
    const turnoverSpec = spec();
    turnoverSpec.stocks[0].bars = D.map((date, index) => ({
      date,
      open: 10,
      close: 10,
      up: 11,
      down: 9,
      turnoverRateF: index + 1,
    }));
    const factorCode = `export default defineFactor({
      name: 'turnover3',
      window: 3,
      compute(bar, ctx) {
        const values = ctx.history(3, 'turnoverRateF');
        if (values.length < 3 || values.some((value) => value == null)) { return null; }
        return values.reduce((sum, value) => sum + value, 0);
      },
    });`;
    const js = await toCommonJs(factorCode, 'factor code');
    const seen: Record<string, number | null> = {};
    const strategy: Strategy = {
      name: 'read free-float turnover history',
      factors: ['turnover'],
      async onBar(ctx) {
        await ctx.ensureBars(['A']);
        seen[ctx.date] = ctx.factor('turnover', 'A');
      },
    };

    await runStrategy({
      start: D[0],
      end: D[4],
      initialCash: 100_000,
      strategy,
      dataPort: fixturePort(turnoverSpec),
      customFactors: [{ key: 'turnover', js, historyFields: ['turnoverRateF'] }],
    });

    expect(seen[D[1]]).toBeNull();
    expect(seen[D[2]]).toBe(6);
    expect(seen[D[4]]).toBe(12);

    const logged: string[] = [];
    await runWalledBacktest(
      {
        code: `export default defineStrategy({
          name: 'walled turnover history',
          factors: ['turnover'],
          async onBar(ctx) {
            await ctx.ensureBars(['A']);
            console.log(ctx.date + '=' + String(ctx.factor('turnover', 'A')));
          },
        });`,
        start: D[0],
        end: D[4],
        initialCash: 100_000,
        customFactors: [{ key: 'turnover', js, historyFields: ['turnoverRateF'] }],
      },
      fixturePort(turnoverSpec),
      undefined,
      (_level, text) => logged.push(text),
    );
    expect(logged).toContain(`${D[2]}=6`);
    expect(logged).toContain(`${D[4]}=12`);
  });

  it('walled lane: the same custom factor computes in-wall (values logged through the wall match)', async () => {
    const js = await toCommonJs(
      `export default defineFactor({ name: 'double pe', compute: (bar) => (bar.peTtm == null ? null : bar.peTtm * 2) });`,
      'factor code',
    );
    const strategyCode = `
      export default defineStrategy({
        name: 'walled custom read',
        factors: ['f1'],
        async onBar(ctx) {
          await ctx.universe();
          console.log(ctx.date + '=' + String(ctx.factor('f1', 'A')));
        },
      });`;
    const logged: string[] = [];
    await runWalledBacktest(
      {
        code: strategyCode,
        start: D[0],
        end: D[4],
        initialCash: 100_000,
        customFactors: [{ key: 'f1', js }],
      },
      fixturePort(specWithValuation()),
      undefined,
      (_level, text) => logged.push(text),
    );
    expect(logged).toContain(`${D[0]}=20`);
    expect(logged).toContain(`${D[4]}=20`);
  });
});

describe('extractFactorKeys (host-side source scan)', () => {
  it('finds published factor keys in ctx.factor reads, deduped', async () => {
    const { extractFactorKeys } = await import('./prepare-custom-factors.js');
    const source = `
      export default defineStrategy({
        factors: ['earnings_yield', 'mf_net_main'],
        onBar(ctx) {
          ctx.factor('earnings_yield', 'A');
          ctx.factor('mom_12_1', 'A');
          ctx.factor('mf_net_main', 'A');
        },
      });`;
    expect(extractFactorKeys(source)).toEqual(['earnings_yield', 'mom_12_1']);
  });

  it('extracts auxiliary history requirements from factor source', async () => {
    const { extractCustomFactorHistoryFields } = await import('./custom-factor.js');
    expect(extractCustomFactorHistoryFields("ctx.history(252, 'turnoverRateF')")).toEqual([
      'turnoverRateF',
    ]);
    expect(extractCustomFactorHistoryFields('ctx.history(21, "turnoverRateF")')).toEqual([
      'turnoverRateF',
    ]);
    expect(extractCustomFactorHistoryFields("ctx.history(504, 'roe')")).toEqual(['roe']);
    expect(extractCustomFactorHistoryFields("ctx.history(504, 'grossprofitMargin')")).toEqual([
      'grossprofitMargin',
    ]);
    expect(extractCustomFactorHistoryFields("ctx.history(21, 'marketClose')")).toEqual([
      'marketClose',
    ]);
    expect(extractCustomFactorHistoryFields('bar.roe && ctx.history(21)')).toEqual([]);
    expect(extractCustomFactorHistoryFields("ctx.history(21, 'amount')")).toEqual([]);
  });
});

describe('market benchmark history for custom factors', () => {
  it('serves exact-date CSI All Share closes on direct and walled lanes', async () => {
    const marketSpec = spec();
    marketSpec.indexDaily = D.map((tradeDate, index) => ({
      tsCode: '000985.CSI',
      tradeDate,
      close: 100 + index,
    }));
    const factorCode = `export default defineFactor({
      name: 'market move',
      window: 3,
      compute(bar, ctx) {
        const closes = ctx.history(3, 'marketClose');
        if (closes.length < 3 || closes.some((value) => value == null)) { return null; }
        return closes[2] - closes[0];
      },
    });`;
    const js = await toCommonJs(factorCode, 'factor code');
    const seen: Record<string, number | null> = {};
    const strategy: Strategy = {
      name: 'read market history',
      factors: ['market_move'],
      async onBar(ctx) {
        await ctx.ensureBars(['A']);
        seen[ctx.date] = ctx.factor('market_move', 'A');
      },
    };

    await runStrategy({
      start: D[0],
      end: D[4],
      initialCash: 100_000,
      strategy,
      dataPort: fixturePort(marketSpec),
      customFactors: [{ key: 'market_move', js, historyFields: ['marketClose'] }],
    });
    expect(seen[D[1]]).toBeNull();
    expect(seen[D[2]]).toBe(2);
    expect(seen[D[4]]).toBe(2);

    const logged: string[] = [];
    await runWalledBacktest(
      {
        code: `export default defineStrategy({
          name: 'walled market history',
          factors: ['market_move'],
          async onBar(ctx) {
            await ctx.ensureBars(['A']);
            console.log(ctx.date + '=' + String(ctx.factor('market_move', 'A')));
          },
        });`,
        start: D[0],
        end: D[4],
        initialCash: 100_000,
        customFactors: [{ key: 'market_move', js, historyFields: ['marketClose'] }],
      },
      fixturePort(marketSpec),
      undefined,
      (_level, text) => logged.push(text),
    );
    expect(logged).toContain(`${D[2]}=2`);
    expect(logged).toContain(`${D[4]}=2`);
  });
});

describe('point-in-time fundamental history for custom factors', () => {
  it('serves the as-of step series aligned with bars, on both lanes', async () => {
    const roeSpec = spec();
    // Two published reports: roe=10 public from D1, roe=16 public from D3 — the aligned history
    // must step exactly on the announcement day, and read null before the first report.
    roeSpec.finaIndicators = [
      {
        tsCode: 'A',
        annDate: D[1],
        roe: 10,
        roeWaa: null,
        roa: 5,
        grossprofitMargin: 30,
        debtToAssets: 40,
      },
      {
        tsCode: 'A',
        annDate: D[3],
        roe: 16,
        roeWaa: null,
        roa: 8,
        grossprofitMargin: 36,
        debtToAssets: 42,
      },
    ];
    const factorCode = `export default defineFactor({
      name: 'fundamental steps',
      window: 3,
      compute(bar, ctx) {
        const roes = ctx.history(3, 'roe');
        const grossMargins = ctx.history(3, 'grossprofitMargin');
        if (roes.length < 3 || grossMargins.length < 3) { return null; }
        const roeSum = roes.reduce((sum, value) => sum + (value ?? 0), 0);
        const marginSum = grossMargins.reduce((sum, value) => sum + (value ?? 0), 0);
        return (bar.roa ?? 0) * 1000000 + roeSum * 1000 + marginSum;
      },
    });`;
    const js = await toCommonJs(factorCode, 'factor code');
    const seen: Record<string, number | null> = {};
    const strategy: Strategy = {
      name: 'read roe history',
      factors: ['roestep'],
      async onBar(ctx) {
        await ctx.loadCrossSection();
        await ctx.ensureBars(['A']);
        seen[ctx.date] = ctx.factor('roestep', 'A');
      },
    };

    await runStrategy({
      start: D[0],
      end: D[4],
      initialCash: 100_000,
      strategy,
      dataPort: fixturePort(roeSpec),
      customFactors: [{ key: 'roestep', js, historyFields: ['roe', 'grossprofitMargin'] }],
    });

    expect(seen[D[1]]).toBeNull(); // only 2 bars of history
    expect(seen[D[2]]).toBe(5 * 1_000_000 + (0 + 10 + 10) * 1000 + (0 + 30 + 30));
    expect(seen[D[3]]).toBe(8 * 1_000_000 + (10 + 10 + 16) * 1000 + (30 + 30 + 36));
    expect(seen[D[4]]).toBe(8 * 1_000_000 + (10 + 16 + 16) * 1000 + (30 + 36 + 36));

    const logged: string[] = [];
    await runWalledBacktest(
      {
        code: `export default defineStrategy({
          name: 'walled roe history',
          factors: ['roestep'],
          async onBar(ctx) {
            await ctx.universe();
            await ctx.ensureBars(['A']);
            console.log(ctx.date + '=' + String(ctx.factor('roestep', 'A')));
          },
        });`,
        start: D[0],
        end: D[4],
        initialCash: 100_000,
        customFactors: [{ key: 'roestep', js, historyFields: ['roe', 'grossprofitMargin'] }],
      },
      fixturePort(roeSpec),
      undefined,
      (_level, text) => logged.push(text),
    );
    expect(logged).toContain(`${D[3]}=${8 * 1_000_000 + (10 + 10 + 16) * 1000 + (30 + 30 + 36)}`);
    expect(logged).toContain(`${D[4]}=${8 * 1_000_000 + (10 + 16 + 16) * 1000 + (30 + 36 + 36)}`);
  });
});
