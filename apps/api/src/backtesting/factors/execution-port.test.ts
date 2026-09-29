import { describeFactors } from './description.js';
import { describe, expect, it, vi } from 'vitest';
import { BacktestingEngine } from '../engine.js';
import { fixturePort } from '../testing/fixture-port.js';
import type { FactorDefinition, FactorComputeRequest } from './execution-port.js';

const dates = ['20240102', '20240103', '20240104'];
function dataFixture() {
  return fixturePort({
    dates,
    stocks: [{ code: 'A', bars: dates.map((date) => ({ date, open: 10, close: 10 })) }],
  });
}
const config = { start: dates[0], end: dates[2], initialCash: 100_000, locale: 'en' as const };
const crossSectional: FactorDefinition = {
  id: 'value',
  kind: 'cross_sectional',
  historyFields: [],
};

function port(definitions: FactorDefinition[]) {
  return {
    describe: vi.fn(async () => describeFactors(definitions)),
    compute: vi.fn(async (request: FactorComputeRequest) =>
      (request.kind === 'cross_sectional' ? request.items : request.indexes).map(() => 42),
    ),
  };
}

describe('engine factor execution port', () => {
  it('executes from definitions and a compute port without receiving any factor source', async () => {
    const execution = port([crossSectional]);
    const dataPort = dataFixture();
    const datesRead = vi.spyOn(dataPort, 'openDates');
    const seen: Array<number | null> = [];
    await new BacktestingEngine({
      ...config,
      dataPort,
      factorExecution: execution,
      strategy: {
        name: 'port only',
        factors: ['value'],
        watch: ['A'],
        async onBar(ctx) {
          await ctx.loadCrossSection();
          seen.push(ctx.factor('value', 'A'));
        },
      },
    }).run();
    expect(seen).toEqual([42, 42, 42]);
    expect(execution.describe).toHaveBeenCalledTimes(1);
    expect(execution.describe.mock.invocationCallOrder[0]).toBeLessThan(
      datesRead.mock.invocationCallOrder[0],
    );
    expect(execution.compute).toHaveBeenCalled();
  });

  it.each([
    ['missing', [], 'value'],
    ['duplicate', [crossSectional, crossSectional], 'Duplicate factor definitions'],
  ] as const)(
    'rejects %s definitions before reading market data',
    async (_label, definitions, message) => {
      const dataPort = dataFixture();
      const datesRead = vi.spyOn(dataPort, 'openDates');
      await expect(
        new BacktestingEngine({
          ...config,
          dataPort,
          factorExecution: port([...definitions]),
          strategy: { name: 'invalid', factors: ['value'], onBar() {} },
        }).run(),
      ).rejects.toThrow(message);
      expect(datesRead).not.toHaveBeenCalled();
    },
  );

  it('loads fundamental histories requested only by execution metadata', async () => {
    const dataPort = dataFixture();
    const fina = vi.spyOn(dataPort, 'finaIndicators');
    await new BacktestingEngine({
      ...config,
      dataPort,
      factorExecution: port([{ ...crossSectional, historyFields: ['roe', 'grossprofitMargin'] }]),
      strategy: { name: 'fundamental metadata', onBar() {} },
    }).run();
    expect(fina).toHaveBeenCalled();
  });

  it.each(['single', 'composite'] as const)(
    'loads yield inputs from %s factor metadata',
    async (kind) => {
      const dataPort = dataFixture();
      const yields = vi.spyOn(dataPort, 'yieldCurvePoints');
      const definition: Extract<FactorDefinition, { kind: 'asset_series' }> = {
        id: 'rates',
        kind: 'asset_series',
        analysisKind: 'panel',
        meta: { window: 2, inputs: ['rates.cgb.yield.10y'] },
      };
      const definitions: FactorDefinition[] =
        kind === 'single'
          ? [definition]
          : [
              {
                id: 'composite',
                kind: 'panel_composite',
                standardization: 'rank',
                assetUniverse: [],
                components: [
                  { direction: 'positive', definition },
                  { direction: 'negative', definition: { ...definition, id: 'rates-other' } },
                ],
              },
            ];
      await new BacktestingEngine({
        ...config,
        dataPort,
        factorExecution: port(definitions),
        strategy: { name: 'rates metadata', onBar() {} },
      }).run();
      expect(yields).toHaveBeenCalledWith(config.end);
    },
  );
});
