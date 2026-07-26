import { describe, expect, it, vi } from 'vitest';
import { etfBasic, fundAdj, fundBasic, fundDaily } from './api.js';
import type { TushareClient } from './client.js';

function fakeClient() {
  const call = vi.fn().mockResolvedValue([]);
  return { call, client: { call } as unknown as TushareClient };
}

describe('Tushare ETF APIs', () => {
  it('requests ETF metadata with index and lifecycle fields', async () => {
    const { call, client } = fakeClient();

    await etfBasic(client);

    expect(call).toHaveBeenCalledWith('etf_basic', {}, expect.stringContaining('index_code'));
    expect(call.mock.calls[0][2]).toContain('list_status');
  });

  it('requests exchange-fund metadata for category enrichment', async () => {
    const { call, client } = fakeClient();

    await fundBasic(client);

    expect(call).toHaveBeenCalledWith(
      'fund_basic',
      { market: 'E' },
      expect.stringContaining('fund_type'),
    );
  });

  it('requests unadjusted ETF daily bars', async () => {
    const { call, client } = fakeClient();
    const params = {
      ts_code: '510300.SH',
      start_date: '20240101',
      end_date: '20241231',
    };

    await fundDaily(client, params);

    expect(call).toHaveBeenCalledWith('fund_daily', params, expect.stringContaining('pre_close'));
    expect(call.mock.calls[0][2]).toContain('amount');
  });

  it('requests ETF adjustment factors', async () => {
    const { call, client } = fakeClient();
    const params = {
      ts_code: '510300.SH',
      start_date: '20240101',
      end_date: '20241231',
    };

    await fundAdj(client, params);

    expect(call).toHaveBeenCalledWith('fund_adj', params, 'ts_code,trade_date,adj_factor');
  });
});
