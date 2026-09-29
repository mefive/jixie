import { StrategyFactor } from '../factors/factor.js';
import {
  StrategyExecution,
  type StrategyExecutionInput,
  type StrategyRunOptions,
} from './execution.js';
import type { UserLogSink } from '#infra/runtime/console.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineDataPort } from '#backtesting/data/data-port.js';
import type { FactorDependency } from '@jixie/shared';

const mocks = vi.hoisted(() => ({
  factorStart: vi.fn(),
  factorExecute: vi.fn(),
  factorClose: vi.fn(),
  strategyStart: vi.fn(),
  strategyClose: vi.fn(),
  engine: vi.fn(),
}));
vi.mock('#factor/runtime/factor-runtime.js', () => ({
  FactorRuntime: { start: mocks.factorStart },
}));
vi.mock('../runtime/strategy-runtime.js', () => ({
  StrategyRuntime: { start: mocks.strategyStart },
}));
vi.mock('#backtesting/engine.js', () => ({
  BacktestingEngine: class {
    constructor(private readonly input: unknown) {}
    run() {
      return mocks.engine(this.input);
    }
  },
}));

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
  factors: [
    new StrategyFactor({
      ...dependency,
      js: 'factor source',
    }),
  ],
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
    mocks.engine.mockResolvedValue({ result: {}, finalState: null });
  });

  it.each(['typescript', 'python'] as const)(
    'loads a %s factor once and reuses it for computation',
    async (language) => {
      mocks.engine.mockImplementation(async (engineConfig) => {
        expect(await engineConfig.factorExecution.describe()).toEqual([
          expect.objectContaining({
            kind: 'asset_series',
            meta: { window: 2, inputs: ['rates.cgb.yield.10y'] },
          }),
        ]);
        expect(engineConfig).not.toHaveProperty('customFactors');
        await engineConfig.factorExecution.describe();
        await engineConfig.factorExecution.compute({
          factorId: 'trend',
          kind: 'asset_series',
          fields: { 'rates.cgb.yield.10y': [2, 3] },
          indexes: [1],
        });
        return { result: {}, finalState: null };
      });
      const result = await runBacktestFixture(
        {
          ...config,
          factors: [
            new StrategyFactor({
              ...dependency,
              js: 'factor source',
              language,
              runtimeVersion: language === 'python' ? 'py-v1' : 'ts-v1',
              code: 'python source',
            }),
          ],
        },
        port,
      );
      expect(mocks.factorStart).toHaveBeenCalledTimes(1);
      expect(mocks.factorStart).toHaveBeenCalledWith(expect.objectContaining({ language }));
      expect(mocks.factorExecute).toHaveBeenCalledTimes(1);
      expect(result.factorDependencies).toEqual([
        {
          ...dependency,
          language,
          runtimeVersion: language === 'python' ? 'py-v1' : 'ts-v1',
          inputs: ['rates.cgb.yield.10y'],
        },
      ]);
      expect(mocks.factorClose).toHaveBeenCalledTimes(1);
      expect(mocks.strategyClose).toHaveBeenCalledTimes(1);
    },
  );

  it('exposes detached resolved lineage before running the engine', async () => {
    const execution = await StrategyExecution.create({ ...config, dataPort: port });
    try {
      const lineage = execution.factorDependencies;
      expect(lineage).toEqual([{ ...dependency, inputs: ['rates.cgb.yield.10y'] }]);
      lineage[0].codeHash = 'changed';
      lineage[0].inputs!.push('etf.adjustedClose');
      expect(execution.factorDependencies).toEqual([
        { ...dependency, inputs: ['rates.cgb.yield.10y'] },
      ]);
      expect(mocks.engine).not.toHaveBeenCalled();
    } finally {
      execution.close();
    }
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
    await expect(runBacktestFixture(config, port)).rejects.toMatchObject({
      reason: 'research_only_inputs_unavailable',
    });
    expect(mocks.engine).not.toHaveBeenCalled();
    expect(mocks.factorClose).toHaveBeenCalledTimes(1);
    expect(mocks.strategyClose).toHaveBeenCalledTimes(1);
  });

  it('returns the same result envelope when final state is requested', async () => {
    const matching = [{ ...dependency, inputs: ['rates.cgb.yield.10y'] }];
    const finalState = { tradeDate: '20240201' };
    mocks.engine.mockResolvedValueOnce({ result: {}, finalState });
    const output = await runFinalStateFixture(config, port);
    expect(output.finalState).toBe(finalState);
    expect(output.result.factorDependencies).toEqual(matching);
    expect(mocks.engine).toHaveBeenCalledWith(expect.objectContaining({ retainFinalState: true }));
    expect(mocks.factorStart).toHaveBeenCalledTimes(1);
  });

  it('owns resources until explicitly closed and closes them only once', async () => {
    const execution = await StrategyExecution.create({ ...config, dataPort: port });
    expect(mocks.engine).not.toHaveBeenCalled();
    await execution.run(config);
    expect(mocks.factorClose).not.toHaveBeenCalled();
    expect(mocks.strategyClose).not.toHaveBeenCalled();
    execution.close();
    execution.close();
    expect(mocks.factorClose).toHaveBeenCalledTimes(1);
    expect(mocks.strategyClose).toHaveBeenCalledTimes(1);
    await expect(execution.run(config)).rejects.toThrow('fresh, open instance');
    expect(mocks.engine).toHaveBeenCalledTimes(1);
  });

  it('rejects overlapping and repeated runs to prevent state reuse', async () => {
    let finish!: (result: object) => void;
    mocks.engine.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const execution = await StrategyExecution.create({ ...config, dataPort: port });
    try {
      const running = execution.run(config);
      await expect(execution.run(config)).rejects.toThrow('fresh, open instance');
      finish({ result: {}, finalState: null });
      await running;
      await expect(execution.run(config)).rejects.toThrow('fresh, open instance');
      expect(mocks.engine).toHaveBeenCalledTimes(1);
    } finally {
      execution.close();
    }
  });

  it('rejects a run after closing an unused instance', async () => {
    const execution = await StrategyExecution.create({ ...config, dataPort: port });
    execution.close();
    await expect(execution.run(config)).rejects.toThrow('fresh, open instance');
    expect(mocks.engine).not.toHaveBeenCalled();
  });

  it('releases the strategy if factor startup fails', async () => {
    mocks.factorStart.mockRejectedValue(new Error('Factor startup failed'));
    await expect(StrategyExecution.create({ ...config, dataPort: port })).rejects.toThrow(
      'Factor startup failed',
    );
    expect(mocks.strategyClose).toHaveBeenCalledTimes(1);
    expect(mocks.engine).not.toHaveBeenCalled();
  });

  it('closes the strategy even when factor cleanup throws', async () => {
    const execution = await StrategyExecution.create({ ...config, dataPort: port });
    mocks.factorClose.mockImplementation(() => {
      throw new Error('Factor cleanup failed');
    });
    expect(() => execution.close()).toThrow('Factor cleanup failed');
    expect(mocks.strategyClose).toHaveBeenCalledTimes(1);
    execution.close();
    expect(mocks.strategyClose).toHaveBeenCalledTimes(1);
  });

  it('closes factors and strategy when the engine fails', async () => {
    mocks.engine.mockRejectedValue(new Error('engine failed'));
    await expect(runBacktestFixture(config, port)).rejects.toThrow('engine failed');
    expect(mocks.factorClose).toHaveBeenCalledTimes(1);
    expect(mocks.strategyClose).toHaveBeenCalledTimes(1);
  });
});

type ExecutionFixtureConfig = Omit<StrategyExecutionInput, 'dataPort'> &
  Omit<StrategyRunOptions, 'retainFinalState'>;

async function runBacktestFixture(
  config: ExecutionFixtureConfig,
  dataPort: EngineDataPort,
  onLog?: (line: string) => void,
  onUserLog?: UserLogSink,
) {
  const execution = await StrategyExecution.create({ ...config, dataPort, onLog, onUserLog });
  try {
    return (await execution.run(config)).result;
  } finally {
    execution.close();
  }
}

async function runFinalStateFixture(
  config: ExecutionFixtureConfig,
  dataPort: EngineDataPort,
  onLog?: (line: string) => void,
  onUserLog?: UserLogSink,
) {
  const execution = await StrategyExecution.create({ ...config, dataPort, onLog, onUserLog });
  try {
    return await execution.run({ ...config, retainFinalState: true });
  } finally {
    execution.close();
  }
}
