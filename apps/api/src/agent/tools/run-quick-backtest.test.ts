import type { BacktestConfig, BacktestMetricSummary } from '@jixie/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    strategy: { findFirst: mocks.findFirst },
  },
}));

import { runQuickBacktestTool } from './run-quick-backtest.js';

const savedConfig: BacktestConfig = {
  name: 'saved name',
  start: '20200101',
  end: '20241231',
  initialCash: 1_000_000,
  cost: { commission: 0.00025 },
  code: 'saved code',
};

const summary: BacktestMetricSummary = {
  start: '20210101',
  end: '20241231',
  days: 960,
  finalValue: 1_250_000,
  totalReturn: 0.25,
  annReturn: 0.057,
  sharpe: 0.8,
  maxDrawdown: -0.12,
  trades: 18,
  benchReturn: 0.1,
  excessReturn: 0.15,
  informationRatio: 0.6,
  calmar: 0.475,
  winRate: 0.55,
  profitFactor: 1.4,
  turnover: 1.2,
  totalFees: 1200,
  totalSlippage: 800,
};

describe('runQuickBacktestTool', () => {
  beforeEach(() => {
    mocks.findFirst.mockReset();
    mocks.findFirst.mockResolvedValue({ name: 'owned strategy', config: savedConfig });
  });

  it('inherits the saved run settings while testing current editor code', async () => {
    const execute = vi.fn(async (_config: BacktestConfig, _context: unknown) => summary);
    const controller = new AbortController();
    const tool = runQuickBacktestTool({
      userId: 'user-1',
      strategyId: 'strategy-1',
      currentCode: 'current editor code',
      locale: 'zh',
      execute,
    });

    const result = await tool.run({ start: '20210101' }, { signal: controller.signal });

    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: 'strategy-1', userId: 'user-1' },
      select: { config: true, name: true },
    });
    expect(execute).toHaveBeenCalledWith(
      {
        ...savedConfig,
        name: 'owned strategy',
        start: '20210101',
        code: 'current editor code',
      },
      { userId: 'user-1', locale: 'zh', signal: controller.signal },
    );
    expect(JSON.parse(result.observation)).toEqual({
      researchOnly: true,
      candidate: { start: '20210101', end: '20241231', initialCash: 1_000_000 },
      metrics: summary,
    });
  });

  it('runs an explicit candidate without saving it', async () => {
    const execute = vi.fn(async (_config: BacktestConfig, _context: unknown) => summary);
    const tool = runQuickBacktestTool({
      userId: 'user-1',
      strategyId: 'strategy-1',
      currentCode: 'current editor code',
      locale: 'en',
      execute,
    });

    await tool.run({ code: 'candidate code', initialCash: 2_000_000 });

    expect(execute.mock.calls[0][0]).toMatchObject({
      code: 'candidate code',
      initialCash: 2_000_000,
    });
  });

  it('rejects a missing or foreign strategy before starting work', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const execute = vi.fn(async (_config: BacktestConfig, _context: unknown) => summary);
    const tool = runQuickBacktestTool({
      userId: 'user-1',
      strategyId: 'strategy-1',
      currentCode: 'current editor code',
      locale: 'zh',
      execute,
    });

    await expect(tool.run({})).rejects.toThrow('Strategy no longer exists');
    expect(execute).not.toHaveBeenCalled();
  });
});
