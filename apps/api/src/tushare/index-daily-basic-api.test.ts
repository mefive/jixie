import { describe, expect, it, vi } from 'vitest';
import type { TushareClient } from './client.js';
import { indexDailyBasic } from './api.js';

describe('Tushare index daily valuation API', () => {
  it('requests provider-computed PE, PE TTM, and PB fields', async () => {
    const call = vi.fn().mockResolvedValue([]);
    const client = { call } as unknown as TushareClient;
    const params = {
      ts_code: '000300.SH',
      start_date: '20040101',
      end_date: '20131231',
    };

    await indexDailyBasic(client, params);

    expect(call).toHaveBeenCalledWith(
      'index_dailybasic',
      params,
      expect.stringContaining('pe_ttm'),
    );
    expect(call.mock.calls[0][2]).toContain('pb');
    expect(call.mock.calls[0][2]).toContain('total_mv');
  });
});
