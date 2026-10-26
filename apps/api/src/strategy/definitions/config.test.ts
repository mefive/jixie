import { describe, expect, it, vi } from 'vitest';
import type { BacktestConfig } from '@jixie/shared';
import {
  commitStrategyConfig,
  strategyRunKey,
  strategyInputSignature,
  strategyResultSettings,
} from './config.js';

const BASE_CONFIG: BacktestConfig = {
  name: 'Breakout',
  start: '20200101',
  end: '20241231',
  initialCash: 1_000_000,
  code: 'export default defineStrategy({})',
};

describe('strategyRunKey', () => {
  it('ignores the display name but includes every cost input', () => {
    expect(strategyRunKey({ ...BASE_CONFIG, name: 'Renamed' })).toBe(strategyRunKey(BASE_CONFIG));
    expect(strategyRunKey({ ...BASE_CONFIG, cost: { commission: 0.0003 } })).not.toBe(
      strategyRunKey(BASE_CONFIG),
    );
  });

  it('normalizes cost property order', () => {
    const first = { commission: 0.0003, stampDuty: 0.0005 };
    const second = { stampDuty: 0.0005, commission: 0.0003 };
    expect(strategyRunKey({ ...BASE_CONFIG, cost: first })).toBe(
      strategyRunKey({ ...BASE_CONFIG, cost: second }),
    );
  });
});

describe('commitStrategyConfig', () => {
  it('saves the editor without duplicating result storage', async () => {
    const update = vi.fn().mockResolvedValue({ id: 's1', name: BASE_CONFIG.name });
    const database = {
      strategy: {
        findFirst: vi.fn().mockResolvedValue({ config: BASE_CONFIG, name: BASE_CONFIG.name }),
        findUnique: vi.fn().mockResolvedValue(null),
        update,
      },
    };

    await commitStrategyConfig(database as never, 'u1', 's1', {
      ...BASE_CONFIG,
      cost: { commission: 0.0003 },
    });

    expect(update.mock.calls[0][0].data).toEqual({
      name: BASE_CONFIG.name,
      config: { ...BASE_CONFIG, cost: { commission: 0.0003 } },
    });
    expect(strategyInputSignature({ ...BASE_CONFIG, code: 'changed' })).not.toBe(
      strategyInputSignature(BASE_CONFIG),
    );
    expect(strategyResultSettings(BASE_CONFIG)).not.toHaveProperty('code');
  });

  it('does not invalidate the result for a name-only update', async () => {
    const update = vi.fn().mockResolvedValue({ id: 's1', name: 'Renamed' });
    const database = {
      strategy: {
        findFirst: vi.fn().mockResolvedValue({ config: BASE_CONFIG, name: BASE_CONFIG.name }),
        findUnique: vi.fn().mockResolvedValue(null),
        update,
      },
    };

    await commitStrategyConfig(database as never, 'u1', 's1', {
      ...BASE_CONFIG,
      name: 'Renamed',
    });

    expect(update.mock.calls[0][0].data).not.toHaveProperty('lastResult');
  });
});
