import { describe, expect, it, vi } from 'vitest';
import { indexBenchmark } from './api.js';
import type { TushareClient } from './tushare-client.js';

describe('Tushare official market-reference APIs', () => {
  it('requests official benchmark type and compiler provenance', async () => {
    const call = vi.fn().mockResolvedValue([]);
    const client = { call } as unknown as TushareClient;

    await indexBenchmark(client);

    expect(call).toHaveBeenCalledWith('mkt_idx_bmk', {}, expect.stringContaining('idx_type'));
    expect(call.mock.calls[0][2]).toContain('bmk_src');
  });
});
