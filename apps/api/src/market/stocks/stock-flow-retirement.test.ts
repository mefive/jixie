import { expect, it, vi } from 'vitest';
import { DATASET_POLICIES } from '../synchronization/policies.js';
import { prepareStockPartition } from './sync-partition.js';

it.each(['stock-moneyflow', 'stock-toplist'])(
  'rejects the retired %s dataset before requesting a source',
  async (dataset) => {
    const source = { call: vi.fn() };
    expect(DATASET_POLICIES.some((policy) => policy.dataset === dataset)).toBe(false);
    await expect(
      prepareStockPartition(source, {
        dataset,
        scope: 'all',
        startDate: '20260915',
        endDate: '20260915',
      }),
    ).rejects.toThrow(`Unknown stock dataset ${dataset}`);
    expect(source.call).not.toHaveBeenCalled();
  },
);
