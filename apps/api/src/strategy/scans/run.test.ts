import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BacktestResult } from '#engine/types.js';
import type { StrategyScanWorkerInput } from './job-payload.js';
import type { SandboxedBacktestConfig } from '../execution/simulation.js';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), simulate: vi.fn(), port: {} }));
vi.mock('../factor-inputs/prepare.js', () => ({ prepareStrategyFactors: mocks.prepare }));

vi.mock('../execution/simulation.js', () => ({ runSandboxedBacktest: mocks.simulate }));
vi.mock('#engine/adapters/prisma-port.js', () => ({ prismaDataPort: mocks.port }));

import { runStrategyScan } from './run.js';

const input: StrategyScanWorkerInput = {
  config: {
    name: 'Scan fixture',
    code: 'strategy source',
    start: '20200101',
    end: '20241231',
    initialCash: 100,
  },
  spec: { dimensions: [{ key: 'lookback', values: [10, 20] }], splitDate: '20221230' },
  parameters: { lookback: 20 },
  ranges: {
    inSample: { start: '20200101', end: '20221230' },
    outOfSample: { start: '20230103', end: '20241231' },
  },
  userId: 'owner',
  locale: 'en',
};
const modules = [{ key: 'quality', js: 'factor source' }];

describe('strategy scan execution', () => {
  beforeEach(() => {
    mocks.simulate.mockReset();
    mocks.prepare.mockReset().mockResolvedValue({ modules, factors: [] });
  });

  it('prepares factors once and runs each combination and sample range in order', async () => {
    const simulate = mocks.simulate.mockImplementation(async (request: SandboxedBacktestConfig) =>
      result(Number(request.paramOverrides!.lookback), request.start, request.end),
    );
    const log = vi.fn();
    const payload = await runStrategyScan(input, log);

    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(input.config.code, input.userId);
    expect(
      simulate.mock.calls.map(([request]) => [
        request.paramOverrides!.lookback,
        request.start,
        request.end,
      ]),
    ).toEqual([
      [10, '20200101', '20221230'],
      [10, '20230103', '20241231'],
      [20, '20200101', '20221230'],
      [20, '20230103', '20241231'],
    ]);
    for (const [request, port] of simulate.mock.calls) {
      expect(port).toBe(mocks.port);
      expect(request.customFactors).toBe(modules);
      expect(request.initialCash).toBe(100);
      expect(request.locale).toBe('en');
    }
    expect(log).toHaveBeenCalledTimes(2);
    expect(payload.parameters).toEqual({ lookback: 20 });
    expect(payload.cells[0]).toMatchObject({
      params: { lookback: 10 },
      inSample: { start: '20200101', totalReturn: 0.1 },
      outOfSample: { start: '20230103', totalReturn: 0.1 },
    });
    expect(payload.cells[0]).not.toHaveProperty('inSample.tradeLog');
  });

  it('retains rebased NAV and path-risk metrics for sizing comparisons', async () => {
    const simulate = mocks.simulate.mockImplementation(async (request: SandboxedBacktestConfig) =>
      result(request.paramOverrides!.sizing === 'atr' ? 20 : 10, request.start, request.end),
    );
    const payload = await runStrategyScan(
      {
        ...input,
        spec: { view: 'sizing', dimensions: [{ key: 'sizing', values: ['equal', 'atr'] }] },
        parameters: { sizing: 'equal' },
        ranges: { full: { start: '20200101', end: '20200103' } },
      },
      vi.fn(),
    );

    expect(simulate).toHaveBeenCalledTimes(2);
    expect(payload.cells[0].nav).toEqual([
      { date: '20200101', value: 1 },
      { date: '20200102', value: 0.9 },
      { date: '20200103', value: 1.1 },
    ]);
    expect(payload.cells[0].full?.annVolatility).toBeGreaterThan(0);
    expect(payload.cells[0].full?.maxUnderwaterDays).toBe(1);
    expect(payload.cells[0].full?.annSlippageDrag).toBeCloseTo(2.52);
  });

  it('applies capacity values to initial cash without passing them as strategy parameters', async () => {
    const simulate = mocks.simulate.mockImplementation(async (request: SandboxedBacktestConfig) =>
      result(10, request.start, request.end),
    );
    const payload = await runStrategyScan(
      {
        ...input,
        spec: {
          view: 'capacity',
          dimensions: [{ key: 'initialCash', values: [10000, 20000, 30000] }],
        },
        ranges: { full: { start: '20200101', end: '20200103' } },
      },
      vi.fn(),
    );
    expect(simulate.mock.calls.map(([request]) => request.initialCash)).toEqual([
      10000, 20000, 30000,
    ]);
    expect(
      simulate.mock.calls.every(([request]) => Object.keys(request.paramOverrides!).length === 0),
    ).toBe(true);
    expect(payload.cells.every((cell) => cell.nav === undefined)).toBe(true);
    expect(input.config.initialCash).toBe(100);
  });

  it('waits for each cell to finish before launching the next', async () => {
    let finishFirst!: (value: BacktestResult) => void;
    const first = new Promise<BacktestResult>((resolve) => {
      finishFirst = resolve;
    });
    let started!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const simulate = mocks.simulate
      .mockImplementation(async (request: SandboxedBacktestConfig) =>
        result(10, request.start, request.end),
      )
      .mockImplementationOnce(() => {
        started();
        return first;
      });
    const running = runStrategyScan(input, vi.fn());
    await firstStarted;
    expect(simulate).toHaveBeenCalledTimes(1);
    finishFirst(result(10, '20200101', '20221230'));
    await running;
    expect(simulate).toHaveBeenCalledTimes(4);
  });

  it('stops the loop when a simulation fails', async () => {
    const simulate = mocks.simulate.mockRejectedValue(new Error('Simulation failed'));
    await expect(runStrategyScan(input, vi.fn())).rejects.toThrow('Simulation failed');
    expect(simulate).toHaveBeenCalledTimes(1);
  });
});

function result(parameter: number, start: string, end: string): BacktestResult {
  return {
    name: 'Fixture',
    start,
    end,
    days: 2,
    initialCash: 100,
    finalValue: 100 + parameter,
    totalReturn: parameter / 100,
    annReturn: parameter / 100,
    sharpe: parameter,
    maxDrawdown: -0.1,
    trades: 1,
    tradeLog: [],
    nav: [
      { date: '20200101', value: 100 },
      { date: '20200102', value: 90 },
      { date: '20200103', value: 100 + parameter },
    ],
    benchReturn: 0,
    excessReturn: parameter / 100,
    informationRatio: 1,
    calmar: 1,
    winRate: 1,
    profitFactor: 2,
    turnover: 1,
    totalFees: 1,
    totalSlippage: 2,
    cost: {
      commission: 0,
      minCommission: 0,
      stampDuty: 0,
      transferFee: 0,
      slippageBps: 0,
      impactCoef: 0,
      futureCommissionRate: 0,
      futureCloseTodayRate: 0,
      futureSlippageTicks: 0,
      futureMarginRate: 0.1,
    },
    monthly: [],
  };
}
