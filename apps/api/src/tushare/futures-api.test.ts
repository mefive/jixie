import { describe, expect, it, vi } from 'vitest';
import type { TushareClient } from './client.js';
import { futureContracts, futureDaily, futureMapping, futureSettlement } from './api.js';

function fakeClient() {
  const call = vi.fn().mockResolvedValue([]);
  return { call, client: { call } as unknown as TushareClient };
}

describe('Tushare stock-index futures APIs', () => {
  it('requests actual CFFEX contract metadata with lifecycle fields', async () => {
    const { call, client } = fakeClient();

    await futureContracts(client, { exchange: 'CFFEX', fut_type: '1' });

    expect(call).toHaveBeenCalledWith(
      'fut_basic',
      { exchange: 'CFFEX', fut_type: '1' },
      expect.stringContaining('multiplier'),
    );
    expect(call.mock.calls[0][2]).toContain('delist_date');
  });

  it('requests daily settlement and open-interest fields for an actual contract', async () => {
    const { call, client } = fakeClient();
    const params = { ts_code: 'IF2509.CFX', start_date: '20250701', end_date: '20250731' };

    await futureDaily(client, params);

    expect(call).toHaveBeenCalledWith('fut_daily', params, expect.stringContaining('pre_settle'));
    expect(call.mock.calls[0][2]).toContain('oi_chg');
  });

  it('requests point-in-time main-contract mappings', async () => {
    const { call, client } = fakeClient();
    const params = { ts_code: 'IF.CFX', start_date: '20250101', end_date: '20251231' };

    await futureMapping(client, params);

    expect(call).toHaveBeenCalledWith('fut_mapping', params, 'ts_code,trade_date,mapping_ts_code');
  });

  it('requests historical fee and margin parameters', async () => {
    const { call, client } = fakeClient();
    const params = { ts_code: 'IM2509.CFX', start_date: '20250701', end_date: '20250731' };

    await futureSettlement(client, params);

    expect(call).toHaveBeenCalledWith(
      'fut_settle',
      params,
      expect.stringContaining('long_margin_rate'),
    );
    expect(call.mock.calls[0][2]).toContain('offset_today_fee');
  });
});
