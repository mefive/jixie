import { StrategyFactor } from '#strategy/factors/factor.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactorDependency } from '@jixie/shared';

const mocks = vi.hoisted(() => ({
  findRun: vi.fn(),
  stocks: vi.fn(),
  etfs: vi.fn(),
  prepare: vi.fn(),
  create: vi.fn(),
  run: vi.fn(),
  close: vi.fn(),
}));
vi.mock('#infra/database/prisma.js', () => ({
  prisma: {
    signalRun: { findUnique: mocks.findRun },
    stockBasic: { findMany: mocks.stocks },
    etfBasic: { findMany: mocks.etfs },
  },
}));
vi.mock('#engine/adapters/prisma-port.js', () => ({ prismaDataPort: {} }));
vi.mock('#strategy/execution/execution.js', () => ({
  StrategyExecution: { create: mocks.create },
}));

import { runSignal } from './run.js';

const dependency: FactorDependency = {
  factorId: 'factor-1',
  key: 'trend',
  name: 'Trend',
  analysisKind: 'time_series',
  codeHash: 'frozen',
  inputs: ['rates.cgb.yield.10y'],
};
const prepared = [new StrategyFactor({ ...dependency, js: 'source' })];

function record(deployment: FactorDependency[] | null, run: FactorDependency[] | null) {
  return {
    userId: 'owner',
    tradeDate: '20240103',
    execDate: '20240104',
    factorDependencies: run,
    deployment: {
      locale: 'en',
      factorDependencies: deployment,
      config: {
        name: 'Fixture',
        code: 'strategy source',
        start: '20240101',
        end: '20240102',
        initialCash: 1000,
      },
    },
  };
}

describe('signal execution lineage admission', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(StrategyFactor, 'prepare').mockImplementation(mocks.prepare);
    mocks.findRun.mockResolvedValue(record([dependency], [dependency]));
    mocks.prepare.mockResolvedValue(prepared);
    mocks.create.mockResolvedValue({
      factorDependencies: [dependency],
      run: mocks.run,
      close: mocks.close,
    });
    mocks.run.mockResolvedValue({
      result: {},
      capture: {
        signals: [],
        modelPositions: [],
        factorObservations: [],
        tradeDate: '20240103',
        modelEquity: 1000,
        modelCash: 1000,
      },
    });
    mocks.stocks.mockResolvedValue([]);
    mocks.etfs.mockResolvedValue([]);
  });

  it('passes paired factors to execution and requests final-day capture after admission', async () => {
    const result = await runSignal('run-1', vi.fn(), vi.fn());
    expect(mocks.create.mock.calls[0][0].factors).toBe(prepared);
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('factorDependencySnapshots');
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ end: '20240103', captureSignals: true }),
    );
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(result.factorInputs[0]).toMatchObject({
      factorId: dependency.factorId,
      key: dependency.key,
    });
  });

  it.each([
    ['deployment drift', [{ ...dependency, codeHash: 'changed' }], [dependency], [dependency]],
    ['run drift', [dependency], [{ ...dependency, codeHash: 'changed' }], [dependency]],
    ['current source drift', [dependency], [dependency], [{ ...dependency, codeHash: 'changed' }]],
    [
      'current input drift',
      [dependency],
      [dependency],
      [{ ...dependency, inputs: ['etf.adjustedClose'] }],
    ],
    ['empty frozen set', [], [], [dependency]],
  ] as const)(
    'rejects %s before running the engine and closes resources',
    async (_name, deployment, run, actual) => {
      mocks.findRun.mockResolvedValue(record([...deployment], [...run]));
      mocks.create.mockResolvedValue({
        factorDependencies: [...actual],
        run: mocks.run,
        close: mocks.close,
      });
      await expect(runSignal('run-1', vi.fn(), vi.fn())).rejects.toThrow(
        'Factor dependency snapshot mismatch',
      );
      expect(mocks.run).not.toHaveBeenCalled();
      expect(mocks.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['deployment', 'run'] as const)(
    'still enforces the remaining legacy %s snapshot',
    async (source) => {
      const changed = [{ ...dependency, codeHash: 'changed' }];
      mocks.findRun.mockResolvedValue(
        record(source === 'deployment' ? changed : null, source === 'run' ? changed : null),
      );
      await expect(runSignal('run-1', vi.fn(), vi.fn())).rejects.toThrow(
        'Factor dependency snapshot mismatch',
      );
      expect(mocks.run).not.toHaveBeenCalled();
      expect(mocks.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['deployment', 'run', 'neither'] as const)(
    'preserves legacy rows with %s snapshot available',
    async (source) => {
      mocks.findRun.mockResolvedValue(
        record(
          source === 'deployment' ? [dependency] : null,
          source === 'run' ? [dependency] : null,
        ),
      );
      await runSignal('run-1', vi.fn(), vi.fn());
      expect(mocks.run).toHaveBeenCalledTimes(1);
      expect(mocks.close).toHaveBeenCalledTimes(1);
    },
  );

  it('closes resources when engine execution fails', async () => {
    mocks.run.mockRejectedValue(new Error('Engine failed'));
    await expect(runSignal('run-1', vi.fn(), vi.fn())).rejects.toThrow('Engine failed');
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
