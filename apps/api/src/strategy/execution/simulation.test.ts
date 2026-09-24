import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineDataPort } from '#engine/data/data-port.js';
import type { FactorDependency } from '@jixie/shared';

const mocks = vi.hoisted(() => ({
  factorStart: vi.fn(),
  factorExecute: vi.fn(),
  factorClose: vi.fn(),
  strategyStart: vi.fn(),
  strategyClose: vi.fn(),
  engine: vi.fn(),
  signals: vi.fn(),
}));
vi.mock('#factor/runtime/factor-runtime.js', () => ({
  FactorRuntime: { start: mocks.factorStart },
}));
vi.mock('../runtime/strategy-runtime.js', () => ({
  StrategyRuntime: { start: mocks.strategyStart },
}));
vi.mock('#engine/simulation/run.js', () => ({
  runStrategy: mocks.engine,
  runStrategyWithSignals: mocks.signals,
}));

import { runSandboxedBacktest, runSandboxedSignalCapture } from './simulation.js';

const dependency: FactorDependency = {
  factorId: 'factor-1',
  key: 'trend',
  name: 'Trend',
  analysisKind: 'time_series',
  codeHash: 'hash',
  approvedReportId: 'report-1',
};
const config = {
  code: 'strategy source',
  start: '20240101',
  end: '20240201',
  initialCash: 1000,
  customFactors: [{ key: 'trend', js: 'factor source', analysisKind: 'time_series' as const }],
  factorDependencies: [dependency],
};
// These tests isolate runtime ownership; the mocked engine never reads market data.
const port = {} as EngineDataPort;

describe('simulation factor initialization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.factorStart.mockResolvedValue({
      metadata: { analysisKind: 'time_series', window: 2, inputs: ['rates.cgb.yield.10y'] },
      execute: mocks.factorExecute.mockResolvedValue([1]),
      close: mocks.factorClose,
    });
    mocks.strategyStart.mockResolvedValue({
      metadata: {},
      execute: vi.fn(),
      close: mocks.strategyClose,
    });
    mocks.engine.mockResolvedValue({});
    mocks.signals.mockResolvedValue({ result: {}, capture: {} });
  });

  it.each(['typescript', 'python'] as const)(
    'loads a %s factor once and reuses it for computation',
    async (language) => {
      mocks.engine.mockImplementation(async (engineConfig) => {
        expect(engineConfig.customFactors[0].assetSeries).toEqual({
          window: 2,
          inputs: ['rates.cgb.yield.10y'],
        });
        await engineConfig.factorExecution.describe();
        await engineConfig.factorExecution.compute({
          factorId: 'trend',
          kind: 'asset_series',
          fields: { 'rates.cgb.yield.10y': [2, 3] },
          indexes: [1],
        });
        return {};
      });
      const result = await runSandboxedBacktest(
        {
          ...config,
          customFactors: [
            {
              ...config.customFactors[0],
              language,
              runtimeVersion: language === 'python' ? 'py-v1' : 'ts-v1',
              code: 'python source',
            },
          ],
        },
        port,
      );
      expect(mocks.factorStart).toHaveBeenCalledTimes(1);
      expect(mocks.factorStart).toHaveBeenCalledWith(expect.objectContaining({ language }));
      expect(mocks.factorExecute).toHaveBeenCalledTimes(1);
      expect(result.factorDependencies).toEqual([
        { ...dependency, inputs: ['rates.cgb.yield.10y'] },
      ]);
      expect(mocks.factorClose).toHaveBeenCalledTimes(1);
      expect(mocks.strategyClose).toHaveBeenCalledTimes(1);
    },
  );

  it('checks both frozen snapshots before signal computation and releases resources on mismatch', async () => {
    const matching = [{ ...dependency, inputs: ['rates.cgb.yield.10y'] }];
    await expect(
      runSandboxedSignalCapture(
        {
          ...config,
          factorDependencySnapshots: [matching, [{ ...dependency, inputs: ['etf.adjustedClose'] }]],
        },
        port,
      ),
    ).rejects.toThrow('Factor dependency snapshot mismatch');
    expect(mocks.signals).not.toHaveBeenCalled();
    expect(mocks.factorClose).toHaveBeenCalledTimes(1);
    expect(mocks.strategyClose).toHaveBeenCalledTimes(1);
  });

  it('rejects research-only inputs before running the engine and closes the initialized factor', async () => {
    mocks.factorStart.mockResolvedValue({
      metadata: {
        analysisKind: 'time_series',
        window: 2,
        inputs: ['commodity.warehouseReceipt.volume'],
      },
      execute: mocks.factorExecute,
      close: mocks.factorClose,
    });
    await expect(runSandboxedBacktest(config, port)).rejects.toMatchObject({
      reason: 'research_only_inputs_unavailable',
    });
    expect(mocks.engine).not.toHaveBeenCalled();
    expect(mocks.factorClose).toHaveBeenCalledTimes(1);
    expect(mocks.strategyClose).toHaveBeenCalledTimes(1);
  });

  it('returns complete signal lineage after successful admission', async () => {
    const matching = [{ ...dependency, inputs: ['rates.cgb.yield.10y'] }];
    const output = await runSandboxedSignalCapture(
      { ...config, factorDependencySnapshots: [matching, matching] },
      port,
    );
    expect(output.result.factorDependencies).toEqual(matching);
    expect(mocks.signals).toHaveBeenCalledTimes(1);
    expect(mocks.factorStart).toHaveBeenCalledTimes(1);
  });

  it('closes factors and strategy when the engine fails', async () => {
    mocks.engine.mockRejectedValue(new Error('engine failed'));
    await expect(runSandboxedBacktest(config, port)).rejects.toThrow('engine failed');
    expect(mocks.factorClose).toHaveBeenCalledTimes(1);
    expect(mocks.strategyClose).toHaveBeenCalledTimes(1);
  });
});
