import { describe, expect, it, vi } from 'vitest';
import type { TushareClient } from './client.js';
import { indexBenchmark, swDaily } from './api.js';

describe('Tushare official market-reference APIs', () => {
  it('requests official benchmark type and compiler provenance', async () => {
    const call = vi.fn().mockResolvedValue([]);
    const client = { call } as unknown as TushareClient;

    await indexBenchmark(client);

    expect(call).toHaveBeenCalledWith('mkt_idx_bmk', {}, expect.stringContaining('idx_type'));
    expect(call.mock.calls[0][2]).toContain('bmk_src');
  });

  it('requests official SW valuation and market-cap fields', async () => {
    const call = vi.fn().mockResolvedValue([]);
    const client = { call } as unknown as TushareClient;
    const params = { trade_date: '20260731' as const };

    await swDaily(client, params);

    expect(call).toHaveBeenCalledWith('sw_daily', params, expect.stringContaining('pe,pb'));
    expect(call.mock.calls[0][2]).toContain('float_mv');
    expect(call.mock.calls[0][2]).toContain('total_mv');
  });
});
