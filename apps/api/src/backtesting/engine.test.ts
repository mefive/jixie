import { describe, expect, it, vi } from 'vitest';
import { fixturePort } from './testing/fixture-port.js';
import { BacktestingEngine } from './engine.js';
import type { BacktestingConfig } from './contract.js';

function config(): BacktestingConfig {
  return {
    start: '20240102',
    end: '20240103',
    initialCash: 10000,
    dataPort: fixturePort({ dates: ['20240102', '20240103'], stocks: [] }),
    strategy: { name: 'lifecycle', onBar: vi.fn() },
  };
}

describe('BacktestingEngine lifecycle', () => {
  it('rejects concurrent and repeated execution without repeating decisions', async () => {
    const input = config();
    const simulation = new BacktestingEngine(input);
    const running = simulation.run();
    await expect(simulation.run()).rejects.toThrow('BacktestingEngine requires a fresh instance');
    const output = await running;
    await expect(simulation.run()).rejects.toThrow('BacktestingEngine requires a fresh instance');
    expect(input.strategy.onBar).toHaveBeenCalledTimes(2);
    expect(output.result.nav).toEqual([
      { date: '20240102', value: 10000 },
      { date: '20240103', value: 10000 },
    ]);
  });

  it('does not reuse partial state after a failed decision', async () => {
    const input = config();
    const onBar = vi.fn(() => {
      throw new Error('decision failed');
    });
    input.strategy.onBar = onBar;
    const simulation = new BacktestingEngine(input);
    await expect(simulation.run()).rejects.toThrow('decision failed');
    await expect(simulation.run()).rejects.toThrow('BacktestingEngine requires a fresh instance');
    expect(onBar).toHaveBeenCalledTimes(1);
  });
});
