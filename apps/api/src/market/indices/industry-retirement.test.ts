import { expect, it, vi } from 'vitest';
import { DATASET_POLICIES } from '../synchronization/policies.js';
import { prepareIndexPartition } from './sync-partition.js';

it.each(['industry-members', 'industry-prices'])(
  'refuses retired %s before requesting source data',
  async (dataset) => {
    const source = { call: vi.fn() };
    expect(DATASET_POLICIES.some((policy) => policy.dataset === dataset)).toBe(false);
    await expect(
      prepareIndexPartition(source, {
        dataset,
        scope: '801780.SI',
        startDate: '20260915',
        endDate: '20260915',
      }),
    ).rejects.toThrow(`Unknown index dataset ${dataset}`);
    expect(source.call).not.toHaveBeenCalled();
  },
);
