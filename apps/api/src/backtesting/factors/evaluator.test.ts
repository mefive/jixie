import { describeFactors } from './description.js';
import { describe, expect, it, vi } from 'vitest';
import { EngineData } from '../data/engine-data.js';
import { fixturePort } from '../testing/fixture-port.js';
import { FactorEvaluator } from './evaluator.js';
import type { FactorDefinition, FactorComputeRequest } from './execution-port.js';

const dates = ['20240102', '20240103'];

async function loadedData() {
  const engineData = new EngineData({
    start: dates[0],
    end: dates[1],
    preloadCodes: ['A', 'B'],
    dataPort: fixturePort({
      dates,
      stocks: ['A', 'B'].map((code) => ({
        code,
        bars: dates.map((date) => ({ date, open: 10, close: 11 })),
      })),
    }),
  });
  await engineData.load();

  return engineData;
}

describe('factor evaluator setup', () => {
  it('indexes definitions and evaluates them in declaration order', async () => {
    const engineData = await loadedData();
    const definitions: FactorDefinition[] = ['second', 'first'].map((id) => ({
      id,
      kind: 'cross_sectional',
      historyFields: [],
    }));
    const compute = vi.fn(async (request: FactorComputeRequest) =>
      request.kind === 'cross_sectional' ? request.items.map(() => 42) : [],
    );
    const evaluator = new FactorEvaluator({
      definitions,
      engineData,
      executionPort: { describe: async () => describeFactors(definitions), compute },
      assetUniverse: ['A', 'B'],
      onComputeError: vi.fn(),
    });

    expect(evaluator.has('first')).toBe(true);
    expect(evaluator.has('second')).toBe(true);
    expect(evaluator.has('missing')).toBe(false);

    await evaluator.evaluate({ date: dates[0], codes: ['A', 'B'] });

    expect(compute.mock.calls.map(([request]) => request.factorId)).toEqual(['second', 'first']);
    expect(evaluator.read('first', dates[0], 'A')).toBe(42);
    expect(evaluator.read('second', dates[0], 'B')).toBe(42);
  });

  it('reports each factor once across instruments and dates, independently per instance', async () => {
    const engineData = await loadedData();
    const definitions: FactorDefinition[] = ['trend', 'momentum'].map((id) => ({
      id,
      kind: 'asset_series',
      analysisKind: 'time_series',
      meta: { window: 1, inputs: ['etf.adjustedClose'] },
    }));
    const compute = vi.fn(async () => []);
    const onComputeError = vi.fn();
    const input = {
      definitions,
      engineData,
      executionPort: { describe: async () => describeFactors(definitions), compute },
      assetUniverse: ['A', 'B'],
      onComputeError,
    };
    const evaluator = new FactorEvaluator(input);

    for (const date of dates) {
      await evaluator.evaluate({ date, codes: ['A', 'B'] });

      expect(evaluator.read('trend', date, 'A')).toBeNull();
      expect(evaluator.read('momentum', date, 'B')).toBeNull();
    }

    const expectedErrors = definitions.map((definition) => [
      definition.id,
      'input etf.adjustedClose requires an ETF code, received A',
    ]);
    expect(onComputeError.mock.calls).toEqual(expectedErrors);
    expect(compute).not.toHaveBeenCalled();

    const anotherEvaluator = new FactorEvaluator(input);
    await anotherEvaluator.evaluate({ date: dates[0], codes: ['A', 'B'] });

    expect(onComputeError.mock.calls).toEqual([...expectedErrors, ...expectedErrors]);
  });

  it('propagates execution failures instead of turning them into reported warnings', async () => {
    const engineData = await loadedData();
    const definitions: FactorDefinition[] = [
      { id: 'value', kind: 'cross_sectional', historyFields: [] },
    ];
    const failure = new Error('Execution unavailable');
    const onComputeError = vi.fn();
    const evaluator = new FactorEvaluator({
      definitions,
      engineData,
      executionPort: {
        describe: async () => describeFactors(definitions),
        compute: vi.fn().mockRejectedValue(failure),
      },
      assetUniverse: ['A'],
      onComputeError,
    });

    await expect(evaluator.evaluate({ date: dates[0], codes: ['A'] })).rejects.toBe(failure);

    expect(onComputeError).not.toHaveBeenCalled();
  });
});
